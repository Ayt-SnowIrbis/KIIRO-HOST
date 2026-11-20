import { ForgotPasswordForm } from "@/components/auth/forms";
import { getRequestI18n } from "@/lib/i18n/server";

export default async function ForgotPasswordPage() {
  const { dictionary } = await getRequestI18n();
  return <ForgotPasswordForm dictionary={dictionary} />;
}
