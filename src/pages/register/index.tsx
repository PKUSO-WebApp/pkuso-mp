import { useEffect, useRef, useState } from 'react'
import { Button, Picker, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { TextField } from '@/components/ui/FormFields'
import { useUser } from '@/context/user-context'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { INSTRUMENT_ORDER } from '@/constants/instruments'
import { supabase } from '@/lib/supabase'
import { routeAfterLogin } from '@/lib/post-auth-route'
import './index.scss'

const INSTRUMENT_OPTIONS = [...INSTRUMENT_ORDER, '其他'] as const

function getCurrentYear(): number {
  return new Date().getFullYear()
}

const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => String(getCurrentYear() - i))
const SEASON_OPTIONS = ['春', '秋'] as const

export default function RegisterPage() {
  const { ready, user } = useUser()
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('register.navTitle')

  const [wechatCode, setWechatCode] = useState('')
  const [wechatBound, setWechatBound] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [instrumentIndex, setInstrumentIndex] = useState<number | null>(null)
  const [college, setCollege] = useState('')
  const [yearIndex, setYearIndex] = useState<number | null>(null)
  const [seasonIndex, setSeasonIndex] = useState<number | null>(null)
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
        if (!cancelled) void supabase.auth.signOut()
      }
    }
    void verifyAndEnter()
    return () => { cancelled = true }
  }, [ready, user])

  const handleWechatBind = async () => {
    try {
      const loginRes = await Taro.login()
      const code = loginRes.code ?? ''
      if (!code) {
        setErrorMsg(t('register.wechatBindFailed'))
        return
      }
      setWechatCode(code)
      setWechatBound(true)
      setErrorMsg(null)
    } catch {
      setErrorMsg(t('register.wechatBindFailed'))
    }
  }

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

    if (!wechatCode) {
      setErrorMsg(t('register.wechatBindFailed'))
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const joinDate = `${YEAR_OPTIONS[yearIndex]}${SEASON_OPTIONS[seasonIndex]}`
      const instrument = INSTRUMENT_OPTIONS[instrumentIndex]

      const { data, error } = await supabase.functions.invoke('register-with-wechat', {
        body: {
          code: wechatCode,
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          instrument,
          college: college.trim(),
          join_date: joinDate,
        },
      })

      if (error || data?.error) {
        const errCode = data?.error
        if (errCode === 'wechat_already_bound') {
          setErrorMsg(t('register.alreadyRegistered'))
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

  if (!ready || !user) {
    return (
      <View className={`${darkClass} flex min-h-full items-center justify-center bg-page-bg`}>
        <Text className='text-sm text-text-muted'>{t('common.actions.loading')}</Text>
      </View>
    )
  }

  return (
    <View className={`${darkClass} pk-register flex flex-col items-center bg-page-bg px-5 pt-8 pb-safe`}>
      <Card className='w-full px-5 py-6'>
        <View className='mb-4 text-center'>
          <Text className='text-xl font-semibold text-text'>{t('register.title')}</Text>
          <Text className='mt-1 block text-sm text-text-muted'>{t('register.subtitle')}</Text>
        </View>

        {/* 微信授权绑定 */}
        <Button
          hoverClass='none'
          className={`mb-3 flex h-11 w-full items-center justify-center rounded-2xl text-sm font-medium disabled:opacity-60 ${
            wechatBound
              ? 'bg-success-bg text-success'
              : 'bg-[#03DB6C] text-white'
          }`}
          disabled={wechatBound || submitting}
          onClick={() => void handleWechatBind()}
        >
          {wechatBound ? t('register.wechatBound') : t('register.wechatBind')}
        </Button>

        <View className='my-6 border-t border-border' />

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('register.nameLabel')}
          placeholder={t('register.namePlaceholder')}
          value={fullName}
          onInput={(e) => { setErrorMsg(null); setFullName(e.detail.value) }}
        />

        <TextField
          className='mb-3'
          labelClass='text-sm font-medium text-text-muted'
          label={t('register.emailLabel')}
          placeholder={t('register.emailPlaceholder')}
          value={email}
          onInput={(e) => { setErrorMsg(null); setEmail(e.detail.value) }}
        />

        {/* 声部选择 */}
        <View className='mb-3'>
          <Text className='mb-1 block text-sm font-medium text-text-muted'>{t('register.instrumentLabel')}</Text>
          <Picker
            mode='selector'
            range={INSTRUMENT_OPTIONS as unknown as string[]}
            value={instrumentIndex ?? 0}
            onChange={(e) => { setErrorMsg(null); setInstrumentIndex(Number(e.detail.value)) }}
          >
            <View className='flex h-10 w-full items-center justify-between overflow-hidden rounded-xl border border-border bg-muted px-3'>
              <Text className={`text-sm ${instrumentIndex !== null ? 'text-text' : 'text-text-muted'}`}>
                {instrumentIndex !== null ? INSTRUMENT_OPTIONS[instrumentIndex] : t('register.instrumentPlaceholder')}
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
          onInput={(e) => { setErrorMsg(null); setCollege(e.detail.value) }}
        />

        {/* 入团时间 */}
        <View className='mb-3'>
          <Text className='mb-1 block text-sm font-medium text-text-muted'>{t('register.joinDateLabel')}</Text>
          <View className='flex gap-2'>
            <Picker
              mode='selector'
              range={YEAR_OPTIONS}
              value={yearIndex ?? 0}
              onChange={(e) => { setErrorMsg(null); setYearIndex(Number(e.detail.value)) }}
            >
              <View className='flex h-10 flex-1 items-center justify-between overflow-hidden rounded-xl border border-border bg-muted px-3'>
                <Text className={`text-sm ${yearIndex !== null ? 'text-text' : 'text-text-muted'}`}>
                  {yearIndex !== null ? YEAR_OPTIONS[yearIndex] : t('register.yearPlaceholder')}
                </Text>
                <Text className='text-xs text-text-muted'>▼</Text>
              </View>
            </Picker>
            <Picker
              mode='selector'
              range={SEASON_OPTIONS as unknown as string[]}
              value={seasonIndex ?? 0}
              onChange={(e) => { setErrorMsg(null); setSeasonIndex(Number(e.detail.value)) }}
            >
              <View className='flex h-10 flex-1 items-center justify-between overflow-hidden rounded-xl border border-border bg-muted px-3'>
                <Text className={`text-sm ${seasonIndex !== null ? 'text-text' : 'text-text-muted'}`}>
                  {seasonIndex !== null ? SEASON_OPTIONS[seasonIndex] : t('register.seasonPlaceholder')}
                </Text>
                <Text className='text-xs text-text-muted'>▼</Text>
              </View>
            </Picker>
          </View>
        </View>

        {/* 协议 */}
        <View
          className='mb-3 flex items-center'
          onClick={() => setAgreed((v) => !v)}
        >
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
