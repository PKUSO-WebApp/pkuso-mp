// 验证码校验 + 执行操作 Edge Function
//
// 流程：JWT 认证 → 校验验证码（匹配 + 未过期 + 未使用）→ 标记 used → 执行操作
// 用途：password_change（修改密码）/ email_change（换绑邮箱 + 同步 profiles.email）
//
// 安全设计：
// - verify_jwt=true：仅登录用户可调用
// - 每次校验消耗最新 alive 码，防止重放
// - 密码修改用 admin API，不依赖用户当前密码（已在前端通过验证码确认身份）

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: 'server misconfigured' })
  }

  // JWT 认证
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(401, { error: 'missing authorization header' })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // 从 JWT 获取 user_id
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return json(401, { error: 'invalid token' })

  const userId = user.id
  const body = await req.json().catch(() => null) as {
    purpose?: string
    code?: string
    new_password?: string
    new_email?: string
  } | null

  if (!body?.purpose || !['password_change', 'email_change'].includes(body.purpose)) {
    return json(400, { error: 'invalid purpose' })
  }
  if (!body.code || body.code.length !== 6) {
    return json(400, { error: 'invalid code format' })
  }

  const purpose = body.purpose as 'password_change' | 'email_change'

  // 查询该用户最新的 alive 同 purpose 码
  const { data: codeRow, error: queryError } = await supabase
    .from('verification_codes')
    .select('id, code, expires_at')
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .eq('used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (queryError || !codeRow) {
    return json(400, { error: 'no valid code found' })
  }

  // 检查过期
  const expiresAt = new Date(codeRow.expires_at).getTime()
  if (Date.now() > expiresAt) {
    // 标记过期码为 used
    await supabase
      .from('verification_codes')
      .update({ used: true })
      .eq('id', codeRow.id)
    return json(400, { error: 'code expired' })
  }

  // 校验码是否匹配
  if (codeRow.code !== body.code.trim()) {
    return json(400, { error: 'code mismatch' })
  }

  // 标记码为 used
  await supabase
    .from('verification_codes')
    .update({ used: true })
    .eq('id', codeRow.id)

  // 执行操作
  if (purpose === 'password_change') {
    if (!body.new_password || body.new_password.trim().length < 6) {
      return json(400, { error: 'password too short' })
    }
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: body.new_password.trim(),
    })
    if (updateError) {
      console.error('[verify-and-update] password update error', updateError)
      return json(500, { error: 'failed to update password' })
    }
    return json(200, { success: true })
  }

  // email_change
  if (!body.new_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.new_email.trim())) {
    return json(400, { error: 'invalid new email' })
  }
  const newEmail = body.new_email.trim()

  // 检查新邮箱是否已被其他用户占用（查 auth.users）
  const { data: emailCheck } = await supabase.rpc('check_email_taken' as never, {
    p_email: newEmail,
    p_exclude_user_id: userId,
  } as never)

  if (emailCheck === true) {
    return json(400, { error: 'email_taken' })
  }

  // 更新 auth.users.email
  const { error: updateEmailError } = await supabase.auth.admin.updateUserById(userId, {
    email: newEmail,
  })
  if (updateEmailError) {
    const msg = updateEmailError.message ?? ''
    if (msg.includes('already') || msg.includes('duplicate') || msg.includes('unique')) {
      return json(400, { error: 'email_taken' })
    }
    console.error('[verify-and-update] email update error', updateEmailError)
    return json(500, { error: 'failed to update email' })
  }

  // 同步 profiles.email
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ email: newEmail })
    .eq('id', userId)

  if (profileError) {
    console.error('[verify-and-update] profile sync error', profileError)
    // 非致命：auth email 已更新，profiles 同步失败仅记录日志
  }

  return json(200, { success: true })
})
