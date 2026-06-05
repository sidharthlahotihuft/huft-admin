import LoginForm from '@/components/auth/LoginForm'
import { PORTALS } from '@/lib/portals'

export default function RoleplayLoginPage() {
  return <LoginForm portal={PORTALS.roleplay} />
}
