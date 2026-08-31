// 发送验证码 Edge Function
//
// 流程：JWT 认证 → 杀死旧 alive 码 → 生成 6 位码 → 存 DB → SMTP 发邮件
// 用途：password_change（发到绑定邮箱）/ email_change（发到新邮箱）
//
// 安全设计：
// - verify_jwt=true：仅登录用户可调用
// - 同 purpose 同用户仅保留最新码，旧码自动标记 used
// - 60 秒冷却：前端控制倒计时，服务端不额外限制（依赖 DB 中旧码被杀死）

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SMTP_HOST = Deno.env.get('SMTP_HOST') ?? ''
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? '465')
const SMTP_USER = Deno.env.get('SMTP_USER') ?? ''
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? ''
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') ?? 'PKU Symphony'

const CODE_LENGTH = 6
const CODE_EXPIRY_MINUTES = 5

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** 生成 6 位数字验证码 */
function generateCode(): string {
  const arr = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b % 10).join('')
}

/** 简易 SMTP 发送（TCP over TLS） */
async function sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const conn = await Deno.connectTls({ port: SMTP_PORT, hostname: SMTP_HOST })
  const reader = conn.readable.getReader()
  const writer = conn.writable.getWriter()

  const send = async (cmd: string): Promise<string> => {
    await writer.write(encoder.encode(cmd + '\r\n'))
    const { value } = await reader.read()
    return decoder.decode(value)
  }

  // SMTP 握手
  await reader.read() // greeting
  await send(`EHLO ${SMTP_HOST}`)
  await send('AUTH LOGIN')
  await send(btoa(SMTP_USER))
  await send(btoa(SMTP_PASS))
  await send(`MAIL FROM:<${SMTP_USER}>`)
  await send(`RCPT TO:<${to}>`)
  await send('DATA')

  const rawEmail = [
    `From: ${SMTP_FROM_NAME} <${SMTP_USER}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(htmlBody))),
    '.',
    '',
  ].join('\r\n')

  await send(rawEmail)
  await send('QUIT')

  writer.releaseLock()
  reader.releaseLock()
  await conn.close()
}

/** 构建验证码邮件 HTML（双语） */
function buildEmailHtml(code: string, purpose: 'password_change' | 'email_change'): string {
  const isPwd = purpose === 'password_change'
  const titleZh = isPwd ? '修改密码验证码' : '换绑邮箱验证码'
  const titleEn = isPwd ? 'Password Change Code' : 'Email Change Code'
  const bodyZh = isPwd
    ? '你正在修改密码。请使用以下验证码完成操作。验证码<strong>有效期为 5 分钟</strong>。'
    : '你正在换绑邮箱。请使用以下验证码完成操作。验证码<strong>有效期为 5 分钟</strong>。'
  const bodyEn = isPwd
    ? 'You are changing your password. Use the code below to complete the operation. This code <strong>expires in 5 minutes</strong>.'
    : 'You are changing your email. Use the code below to complete the operation. This code <strong>expires in 5 minutes</strong>.'
  const ignoreZh = '如果你没有请求此操作，请忽略本邮件，你的账号仍然安全。'
  const ignoreEn = "If you didn't request this, you can safely ignore this email. Your account remains secure."

  return `<div style="font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 28px 24px; color: #333333; background-color: #ffffff;">
  <h2 style="font-size: 20px; line-height: 1.5; color: #1a237e; margin: 0 0 20px; font-weight: 700;">
    ${titleZh}<br>
    <span lang="en">${titleEn}</span>
  </h2>

  <p lang="zh" style="font-size: 14px; line-height: 1.8; margin: 0 0 12px;">
    你好：
  </p>
  <p lang="zh" style="font-size: 14px; line-height: 1.8; margin: 0 0 20px;">
    ${bodyZh}
  </p>

  <p lang="en" style="font-size: 14px; line-height: 1.8; margin: 0 0 12px;">
    Hello,
  </p>
  <p lang="en" style="font-size: 14px; line-height: 1.8; margin: 0 0 20px;">
    ${bodyEn}
  </p>

  <p style="margin: 26px 0; text-align: center;">
    <span style="background-color: #1a56db; color: #ffffff; padding: 14px 36px; border-radius: 6px; font-size: 24px; font-weight: 700; letter-spacing: 6px; display: inline-block;">
      ${code}
    </span>
  </p>

  <p lang="zh" style="font-size: 13px; line-height: 1.7; color: #555555; margin: 0 0 6px;">
    ${ignoreZh}
  </p>
  <p lang="en" style="font-size: 13px; line-height: 1.7; color: #555555; margin: 0 0 20px;">
    ${ignoreEn}
  </p>

  <hr style="border: none; border-top: 1px solid #eeeeee; margin: 20px 0;">

  <p lang="zh" style="font-size: 12px; line-height: 1.7; color: #999999; margin: 0 0 4px;">
    本邮件由 PKUSO 管理系统自动发送，请勿直接回复。如有疑问，请联系 PKUSO-Web 团队。
  </p>
  <p lang="en" style="font-size: 12px; line-height: 1.7; color: #999999; margin: 0;">
    This is an automated message from PKUSO Management System. Please do not reply. If you have any questions, contact the PKUSO-Web Team.
  </p>
</div>`
}

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
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
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
    new_email?: string
  } | null

  if (!body?.purpose || !['password_change', 'email_change'].includes(body.purpose)) {
    return json(400, { error: 'invalid purpose' })
  }

  const purpose = body.purpose as 'password_change' | 'email_change'

  // 确定收件人
  let targetEmail: string
  if (purpose === 'password_change') {
    targetEmail = user.email ?? ''
    if (!targetEmail) return json(400, { error: 'no bound email' })
  } else {
    // email_change: 需要 new_email 参数
    if (!body.new_email) return json(400, { error: 'missing new_email' })
    const newEmail = body.new_email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return json(400, { error: 'invalid email format' })
    }
    if (newEmail.toLowerCase() === (user.email ?? '').toLowerCase()) {
      return json(400, { error: 'new email same as current' })
    }
    targetEmail = newEmail
  }

  // 杀死该用户该 purpose 的所有 alive 码
  await supabase
    .from('verification_codes')
    .update({ used: true })
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .eq('used', false)

  // 生成 6 位验证码
  const code = generateCode()
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000).toISOString()

  // 存入 DB
  const { error: insertError } = await supabase
    .from('verification_codes')
    .insert({
      user_id: userId,
      code,
      purpose,
      target_email: targetEmail,
      expires_at: expiresAt,
    })

  if (insertError) {
    console.error('[send-verification-code] insert error', insertError)
    return json(500, { error: 'failed to store code' })
  }

  // 发送邮件
  const subject = `【PKUSO】你的验证码 / Your Verification Code`
  const htmlBody = buildEmailHtml(code, purpose)

  try {
    await sendEmail(targetEmail, subject, htmlBody)
  } catch (err) {
    console.error('[send-verification-code] smtp error', err)
    return json(500, { error: 'failed to send email' })
  }

  return json(200, { success: true })
})
