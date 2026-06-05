import LoginForm from '@/components/auth/LoginForm'
import { PORTALS } from '@/lib/portals'

export default function ERPLoginPage() {
  return <LoginForm portal={PORTALS.erp} />
}
