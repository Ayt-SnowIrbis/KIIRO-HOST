\set ON_ERROR_STOP on
\echo === INCUS TEST PREFLIGHT (READ ONLY) ===
BEGIN READ ONLY;
SELECT p.id, p.slug, p.status, n.id AS node_id, n.name AS node_name,
       n.status AS node_status, n.external_id, n.metadata AS node_metadata,
       r.id AS region_id, r.code, r.enabled AS region_enabled
FROM nodes n JOIN providers p ON p.id=n.provider_id
JOIN regions r ON r.id=n.region_id
WHERE n.id='incus-test-node-01';
\echo === AVAILABLE INCUS IMAGES ===
SELECT id, slug, name, version, enabled, kind_support
FROM os_images WHERE provider_id=(SELECT id FROM providers WHERE slug='INCUS')
ORDER BY slug LIMIT 20;
\echo === AVAILABLE CONTAINER PLANS ===
SELECT id, slug, name, vcpu, memory_mb, disk_gb, enabled
FROM plans WHERE 'CONTAINER' = ANY(kind_support)
ORDER BY slug LIMIT 20;
\echo === CUSTOMERS (COUNTS ONLY; NO PERSONAL DATA) ===
SELECT count(*) AS total_customers FROM customers;
\echo === EXISTING REAL INSTANCES ON TEST NODE ===
SELECT id, name, external_id, status, desired_state, observed_state, metadata
FROM instances WHERE node_id='incus-test-node-01';
\echo === ACTIVE TASKS ON TEST NODE ===
SELECT t.id, t.type, t.status, t.instance_id, t.created_at
FROM tasks t JOIN instances i ON i.id=t.instance_id
WHERE i.node_id='incus-test-node-01' AND t.status IN ('QUEUED','RUNNING')
ORDER BY t.created_at;
\echo === EXISTING TEST FIXTURE IDS ===
SELECT id, name, external_id, status FROM instances WHERE external_id='kiiro-test-01';
ROLLBACK;
\echo === PREFLIGHT COMPLETE; NO CHANGES MADE ===
