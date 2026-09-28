import { useEffect, useRef, useState } from 'react'
import { Button, Picker, Text, View } from '@tarojs/components'
import Taro, { useShareAppMessage } from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { TextField } from '@/components/ui/FormFields'
import { LanguageToggle } from '@/components/ui/LanguageToggle'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { INSTRUMENT_ORDER } from '@/constants/instruments'
import { supabase } from '@/lib/supabase'
import { routeAfterLogin } from '@/lib/post-auth-route'
import { getAcademicYearLabel } from '@/lib/academic-year'
import { invokeFunction } from '@/lib/functions'
import type { TFn } from '@/i18n/core'
import { usePlaceholderStyle } from '@/hooks/usePlaceholderStyle'
import './index.scss'

function getInstrumentOptions(t: TFn) {
  return [...INSTRUMENT_ORDER, t('register.otherInstrument')] as const
}

function getCurrentYear(): number {
  return new Date().getFullYear()
}

const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => String(getCurrentYear() - i))

function getSeasonOptions(t: TFn) {
  return [t('register.seasonSpring'), t('register.seasonFall')] as const
}

export default function RegisterPage() {
  const { ready, user } = useUser()
  const darkClass = useThemeClass()
  const { t, locale, setLocale } = useT()
  const placeholderStyle = usePlaceholderStyle()
  useNavTitle('register.navTitle')

  useShareAppMessage(() => {
    return {
      title: `${getAcademicYearLabel()} ${t('register.shareTitle')}`,
    }
  })

  const [wechatCode, setWechatCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState(() => {
    const routerEmail = Taro.getCurrentInstance().router?.params?.email
    return routerEmail ? decodeURIComponent(routerEmail) : ''
  })
  const [instrumentIndex, setInstrumentIndex] = useState<number | null>(null)
  const [college, setCollege] = useState('')
  const [yearIndex, setYearIndex] = useState<number | null>(null)
  const [seasonIndex, setSeasonIndex] = useState<number | null>(null)
  const [inOrchestra, setInOrchestra] = useState<boolean | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!ready || !user) return
    let cancelled = false
    const verifyAndEnter = async () => {
      try {
        await supabase.auth.getUser()
        if (cancelled) return
        await routeAfterLogin(supabase)
      } catch {
        // 同上：只清本机，别把该用户其他设备的会话一并撤销
        if (!cancelled) void supabase.auth.signOut({ scope: 'local' })
      }
    }
    void verifyAndEnter()
    return () => {
      cancelled = true
    }
  }, [ready, user])

  // 静默获取微信 code（wx.login 不需要用户授权）
  useEffect(() => {
    let cancelled = false
    const fetchCode = async () => {
      try {
        const loginRes = await Taro.login()
        if (!cancelled) setWechatCode(loginRes.code ?? '')
      } catch {
        // 静默失败，提交时会提示
      }
    }
    void fetchCode()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async () => {
    if (submittingRef.current || submitting) return
    setErrorMsg(null)

    if (!agreed) {
      Taro.showToast({ title: t('register.agreementRequired'), icon: 'none' })
      return
    }
    if (!fullName.trim()) {
      setErrorMsg(t('register.requiredToast'))
      return
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg(t('register.requiredToast'))
      return
    }
    if (instrumentIndex === null) {
      setErrorMsg(t('register.requiredToast'))
      return
    }
    if (!college.trim()) {
      setErrorMsg(t('register.requiredToast'))
      return
    }
    if (yearIndex === null || seasonIndex === null) {
      setErrorMsg(t('register.requiredToast'))
      return
    }
    if (inOrchestra === null) {
      setErrorMsg(t('register.requiredToast'))
      return
    }

    if (!wechatCode) {
      setErrorMsg(t('register.wechatBindFailed'))
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const joinDate = `${YEAR_OPTIONS[yearIndex]}${getSeasonOptions(t)[seasonIndex]}`
      const instrument = getInstrumentOptions(t)[instrumentIndex]

      const { data, error } = await invokeFunction(supabase, 'register-with-wechat', {
        body: {
          code: wechatCode,
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          instrument,
          college: college.trim(),
          join_date: joinDate,
          is_in_orchestra: inOrchestra,
        },
      })

      if (error || data?.error) {
        const errCode = data?.error
        if (errCode === 'wechat_already_bound') {
          setErrorMsg(t('register.alreadyRegistered'))
        } else if (errCode === 'email_already_registered') {
          setErrorMsg(t('register.emailAlreadyRegistered'))
        } else {
          setErrorMsg(t('register.registerFailed'))
        }
        return
      }

      if (data?.access_token && data?.refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        })
        if (sessionError) {
          setErrorMsg(t('register.registerFailed'))
          return
        }
        Taro.showToast({ title: t('register.registerSuccess'), icon: 'none' })
        await routeAfterLogin(supabase)
      }
    } catch {
      setErrorMsg(t('register.registerFailed'))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (!ready) {
    return (
      <View className={`${darkClass} flex min-h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  return (
    <View
      className={`${darkClass} pk-register flex flex-col items-center bg-page-bg px-5 pt-8 pb-safe`}
    >
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 flex items-center justify-between'>
          <Text className='text-xl font-semibold text-text'>{t('register.title')}</Text>
          <LanguageToggle locale={locale} onChange={setLocale} />
        </View>

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('register.nameLabel')}
          placeholder={t('register.namePlaceholder')}
          value={fullName}
          onInput={(e) => {
            setErrorMsg(null)
            setFullName(e.detail.value)
          }}
          placeholderStyle={placeholderStyle}
        />

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('register.emailLabel')}
          placeholder={t('register.emailPlaceholder')}
          value={email}
          onInput={(e) => {
            setErrorMsg(null)
            setEmail(e.detail.value)
          }}
          placeholderStyle={placeholderStyle}
        />

        {/* 声部选择 */}
        <View className='mb-3'>
          <Text className='mb-1 block text-sm font-medium text-text-muted'>
            {t('register.instrumentLabel')}
          </Text>
          <Picker
            mode='selector'
            range={getInstrumentOptions(t) as unknown as string[]}
            value={instrumentIndex ?? 0}
            onChange={(e) => {
              setErrorMsg(null)
              setInstrumentIndex(Number(e.detail.value))
            }}
          >
            <View className='flex h-10 w-full items-center justify-between overflow-hidden rounded-xl border border-border bg-muted px-3'>
              <Text
                className={`text-sm ${instrumentIndex !== null ? 'text-text' : 'text-text-muted'}`}
              >
                {instrumentIndex !== null
                  ? getInstrumentOptions(t)[instrumentIndex]
                  : t('register.instrumentPlaceholder')}
              </Text>
              <Text className='text-xs text-text-muted'>▼</Text>
            </View>
          </Picker>
        </View>

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('register.collegeLabel')}
          placeholder={t('register.collegePlaceholder')}
          value={college}
          onInput={(e) => {
            setErrorMsg(null)
            setCollege(e.detail.value)
          }}
          placeholderStyle={placeholderStyle}
        />

        {/* 入团时间 */}
        <View className='mb-3'>
          <Text className='mb-1 block text-sm font-medium text-text-muted'>
            {t('register.joinDateLabel')}
          </Text>
          <View className='flex w-full gap-2'>
            <Picker
              mode='selector'
              range={YEAR_OPTIONS}
              value={yearIndex ?? 0}
              onChange={(e) => {
                setErrorMsg(null)
                setYearIndex(Number(e.detail.value))
              }}
              className='flex-1'
            >
              <View className='flex h-10 w-full min-w-0 items-center justify-between overflow-hidden rounded-xl border border-border bg-muted px-3'>
                <Text className={`text-sm ${yearIndex !== null ? 'text-text' : 'text-text-muted'}`}>
                  {yearIndex !== null ? YEAR_OPTIONS[yearIndex] : t('register.yearPlaceholder')}
                </Text>
                <Text className='text-xs text-text-muted'>▼</Text>
              </View>
            </Picker>
            <Picker
              mode='selector'
              range={getSeasonOptions(t) as unknown as string[]}
              value={seasonIndex ?? 0}
              onChange={(e) => {
                setErrorMsg(null)
                setSeasonIndex(Number(e.detail.value))
              }}
              className='flex-1'
            >
              <View className='flex h-10 w-full min-w-0 items-center justify-between overflow-hidden rounded-xl border border-border bg-muted px-3'>
                <Text
                  className={`text-sm ${seasonIndex !== null ? 'text-text' : 'text-text-muted'}`}
                >
                  {seasonIndex !== null
                    ? getSeasonOptions(t)[seasonIndex]
                    : t('register.seasonPlaceholder')}
                </Text>
                <Text className='text-xs text-text-muted'>▼</Text>
              </View>
            </Picker>
          </View>
        </View>

        {/* 在团情况 */}
        <View className='mb-3 flex items-center justify-between'>
          <Text className='text-sm font-medium text-text-muted'>
            {t('register.enrollmentStatusLabel')}
          </Text>
          <View className='flex gap-4'>
            <View
              className='flex-1 flex items-center gap-2'
              onClick={() => {
                setErrorMsg(null)
                setInOrchestra(true)
              }}
            >
              <View
                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                  inOrchestra === true ? 'border-primary bg-primary' : 'border-border bg-page-bg'
                }`}
              >
                {inOrchestra === true && (
                  <View className='h-2.5 w-2.5 rounded-full bg-primary-foreground' />
                )}
              </View>
              <Text className='text-sm text-text'>{t('register.enrollmentStatusEnrolled')}</Text>
            </View>
            <View
              className='flex-1 flex items-center gap-2'
              onClick={() => {
                setErrorMsg(null)
                setInOrchestra(false)
              }}
            >
              <View
                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                  inOrchestra === false ? 'border-primary bg-primary' : 'border-border bg-page-bg'
                }`}
              >
                {inOrchestra === false && (
                  <View className='h-2.5 w-2.5 rounded-full bg-primary-foreground' />
                )}
              </View>
              <Text className='text-sm text-text'>{t('register.enrollmentStatusNotEnrolled')}</Text>
            </View>
          </View>
        </View>

        {/* 协议 */}
        <View className='mb-3 flex items-center' onClick={() => setAgreed((v) => !v)}>
          <View
            className={`mr-2 flex h-5 w-5 items-center justify-center rounded border ${
              agreed ? 'border-primary bg-primary' : 'border-border bg-page-bg'
            }`}
          >
            {agreed ? <Text className='text-xs text-primary-foreground'>✓</Text> : null}
          </View>
          <Text className='text-sm text-text-muted'>{t('common.agreement.checkbox')}</Text>
          <Text
            className='text-sm text-primary'
            onClick={(e) => {
              e.stopPropagation()
              void Taro.navigateTo({ url: '/pages/agreement/index' })
            }}
          >
            {t('common.agreement.linkText')}
          </Text>
        </View>

        {errorMsg ? (
          <View className='mb-3 rounded-xl bg-danger-bg px-3 py-2 text-center text-sm text-danger'>
            {errorMsg}
          </View>
        ) : null}

        <Button
          hoverClass='none'
          className='flex h-11 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60'
          disabled={submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? t('register.submitting') : t('register.submit')}
        </Button>
      </Card>

      <View className='mt-4 text-center'>
        <Text className='text-sm text-text-muted'>
          {t('register.hasAccount')}{' '}
          <Text
            className='font-medium text-primary'
            onClick={() => void Taro.reLaunch({ url: '/pages/login/index' })}
          >
            {t('register.goLogin')}
          </Text>
        </Text>
      </View>
    </View>
  )
}
