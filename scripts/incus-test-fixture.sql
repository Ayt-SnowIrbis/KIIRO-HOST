\set ON_ERROR_STOP on
\echo === INCUS TEST FIXTURE: VALIDATE AND CREATE ===
BEGIN;
DO $$
DECLARE
  v_customer text := 'cmwq9e3vb0001nx01dl9w962p';
  v_node text := 'incus-test-node-01';
  v_region text := 'incus-test-region-01';
  v_provider text;
  v_plan text := 'incus-test-plan-2c1g';
  v_image text := 'incus-test-image-ubuntu-2404';
  v_instance text := 'incus-test-instance-01';
  v_owner text;
  v_count integer;
BEGIN
  SELECT id INTO STRICT v_provider FROM providers WHERE slug='INCUS';
  IF NOT EXISTS (
    SELECT 1 FROM customers c JOIN users u ON u.id=c.user_id
    WHERE c.id=v_customer AND u.email='atalakin@gmail.com' AND u.status='ACTIVE' AND u.role='USER'
  ) THEN RAISE EXCEPTION 'Test customer mismatch or inactive'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM nodes n JOIN regions r ON r.id=n.region_id
    WHERE n.id=v_node AND n.provider_id=v_provider AND n.region_id=v_region
      AND n.external_id='incus-01-test' AND n.status='OFFLINE'
      AND n.metadata->>'mode'='REAL' AND n.metadata->>'testNode'='true'
      AND r.enabled=false
  ) THEN RAISE EXCEPTION 'Test node or region guard failed'; END IF;
  SELECT count(*) INTO v_count FROM instances WHERE node_id=v_node OR external_id='kiiro-test-01';
  IF v_count > 0 AND NOT EXISTS (
    SELECT 1 FROM instances WHERE id=v_instance AND customer_id=v_customer
      AND provider_id=v_provider AND node_id=v_node AND region_id=v_region
      AND external_id='kiiro-test-01' AND metadata->>'mode'='REAL'
      AND metadata->>'testFixture'='true'
  ) THEN RAISE EXCEPTION 'Conflicting instance exists'; END IF;
  IF EXISTS (
    SELECT 1 FROM tasks t JOIN instances i ON i.id=t.instance_id
    WHERE i.node_id=v_node AND t.status IN ('QUEUED','RUNNING')
  ) THEN RAISE EXCEPTION 'Test node has active tasks'; END IF;

  INSERT INTO plans(id,slug,name,description,vcpu,memory_mb,disk_gb,kind_support,enabled)
  VALUES(v_plan,'incus-test-2c1g','Incus Integration Test 2 vCPU / 1 GiB',
    'Internal test fixture; not for sale',2,1024,10,ARRAY['CONTAINER'::"InstanceKind"],false)
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM plans WHERE id=v_plan AND slug='incus-test-2c1g'
      AND vcpu=2 AND memory_mb=1024 AND disk_gb=10 AND enabled=false
      AND 'CONTAINER'=ANY(kind_support)
  ) THEN RAISE EXCEPTION 'Test plan conflict'; END IF;

  INSERT INTO os_images(id,provider_id,slug,name,version,os_family,kind_support,enabled,metadata)
  VALUES(v_image,v_provider,'incus-test-ubuntu-2404','Ubuntu 24.04 LTS (Incus test)',
    '24.04','ubuntu',ARRAY['CONTAINER'::"InstanceKind"],false,
    '{"mode":"REAL","testFixture":true}'::jsonb)
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM os_images WHERE id=v_image AND provider_id=v_provider
      AND slug='incus-test-ubuntu-2404' AND enabled=false
      AND metadata->>'testFixture'='true'
  ) THEN RAISE EXCEPTION 'Test image conflict'; END IF;

  INSERT INTO instances(id,customer_id,provider_id,node_id,region_id,image_id,plan_id,
    name,external_id,kind,status,desired_state,observed_state,vcpu,memory_mb,disk_gb,metadata,updated_at)
  VALUES(v_instance,v_customer,v_provider,v_node,v_region,v_image,v_plan,
    'kiiro-test-01','kiiro-test-01','CONTAINER','RUNNING','RUNNING','RUNNING',
    2,1024,10,'{"mode":"REAL","testFixture":true,"isolated":true}'::jsonb,now())
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM instances WHERE id=v_instance AND customer_id=v_customer
      AND provider_id=v_provider AND node_id=v_node AND region_id=v_region
      AND image_id=v_image AND plan_id=v_plan AND external_id='kiiro-test-01'
      AND metadata->>'mode'='REAL' AND metadata->>'testFixture'='true'
  ) THEN RAISE EXCEPTION 'Test instance conflict'; END IF;
END $$;
COMMIT;
\echo === TEST INSTANCE ===
SELECT i.id,i.name,i.external_id,i.status,i.desired_state,i.observed_state,
       i.customer_id,i.node_id,i.plan_id,i.image_id
FROM instances i WHERE i.id='incus-test-instance-01';
\echo === TEST NODE IS STILL OFFLINE ===
SELECT id,status FROM nodes WHERE id='incus-test-node-01';
\echo === TEST REGION IS STILL DISABLED ===
SELECT id,enabled FROM regions WHERE id='incus-test-region-01';
