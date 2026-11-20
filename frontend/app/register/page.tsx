import { RegisterForm } from "@/components/auth/forms";
import { getRequestI18n } from "@/lib/i18n/server";

export default async function RegisterPage() {
  const { dictionary } = await getRequestI18n();
  return <RegisterForm dictionary={dictionary} />;
}
