import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { PortalConfig } from '@/lib/portals'

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type Fields = z.infer<typeof schema>

interface LoginFormProps {
  portal: PortalConfig
}

export default function LoginForm({ portal }: LoginFormProps) {
  const navigate = useNavigate()
  const { signIn, loading, error, accessDenied } = useAuth(portal.allowedRoles)
  const [showPassword, setShowPassword] = useState(false)

  // Redirect if already authenticated with an allowed role
  useEffect(() => {
    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data: staff } = await supabase
        .from('staff')
        .select('*')
        .eq('id', session.user.id)
        .single()
      if (staff && portal.allowedRoles.includes(staff.role)) {
        navigate(portal.overviewPath, { replace: true })
      }
    }
    check()
  }, [navigate, portal])

  const { register, handleSubmit, formState: { errors } } = useForm<Fields>({
    resolver: zodResolver(schema),
  })

  const onSubmit = async (data: Fields) => {
    const result = await signIn(data.email, data.password)
    if (result.success) navigate(portal.overviewPath, { replace: true })
  }

  const roleList = portal.allowedRoles.join(' or ')

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex w-1/2 flex-col items-center justify-center px-16 py-12 text-white"
        style={{ background: portal.loginGradient }}
      >
        <div className="mb-12 text-center">
          <div className="text-8xl mb-5 drop-shadow-md">{portal.emoji}</div>
          <h1 className="text-4xl font-bold tracking-tight">{portal.name}</h1>
          <p className="mt-2 text-lg font-medium text-white/75">{portal.subtitle}</p>
          <p className="mt-3 max-w-xs text-sm text-white/55">{portal.tagline}</p>
        </div>

        <div className="w-full max-w-xs space-y-6">
          {portal.features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold leading-tight">{title}</p>
                <p className="mt-0.5 text-sm text-white/65">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-white px-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <span className="text-5xl">{portal.emoji}</span>
            <p className="mt-1 text-sm text-gray-400">{portal.name}</p>
          </div>

          <Card className="border-0 bg-transparent shadow-none ring-0">
            <CardHeader className="px-0 pb-6">
              <CardTitle className="text-2xl font-bold text-gray-900">Welcome back</CardTitle>
              <CardDescription className="text-sm text-gray-500">
                {portal.name} · {roleList} access
              </CardDescription>
            </CardHeader>

            <CardContent className="px-0">
              <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
                {/* Email */}
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-gray-700">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@huft.com"
                    autoComplete="email"
                    aria-invalid={!!errors.email}
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  )}
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-gray-700">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      aria-invalid={!!errors.password}
                      className="pr-10"
                      {...register('password')}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password.message}</p>
                  )}
                </div>

                {/* Error / access denied */}
                {(error || accessDenied) && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                    {accessDenied
                      ? `Access denied. This portal requires ${roleList} role.`
                      : error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="mt-1 h-10 w-full font-semibold text-white border-transparent"
                  style={{ backgroundColor: portal.accentColor }}
                >
                  {loading ? 'Signing in…' : 'Sign In'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
