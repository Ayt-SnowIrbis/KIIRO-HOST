import { ResendVerificationForm } from "@/components/auth/forms";
import { getRequestI18n } from "@/lib/i18n/server";

export default async function ResendVerificationPage() {
  const { dictionary } = await getRequestI18n();
  return <ResendVerificationForm dictionary={dictionary} />;
}
