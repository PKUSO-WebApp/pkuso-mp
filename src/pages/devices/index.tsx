import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { ListState } from '@/components/ui/ListState'
import { Modal } from '@/components/ui/Modal'
import { useThemeClass } from '@/context/theme-context'
import { useT, useNavTitle } from '@/i18n'
import { getOrCreateDeviceId } from '@/lib/device-id'
import { listMyDevices, setDeviceTrust, type DeviceInfo } from '@/lib/device-session'
import { supabase } from '@/lib/supabase'
import { formatDateTimeInChina } from '@/lib/date-utils'
import './index.scss'

/**
 * 登录设备（「我的 → 设置 → 登录设备」进入）。
 *
 * 多设备模型下没有「顶号」：每台设备在 user_devices 里各占一行，互不影响。
 * 这里唯一的动作是「设为不信任」——该设备立刻下线，且在被恢复信任之前拒绝它再登录
 * （行会保留，所以能恢复）。**本机那一行不提供这个入口**：把自己拒绝掉会当场把自己
 * 锁在门外（服务端也会以 cannot_untrust_self 硬拦）。
 */
export default function DevicesPage() {
  const darkClass = useThemeClass()
  const { t } = useT()
  useNavTitle('devices.navTitle')

  // 本机标识：与登录/轮询用的是同一个 device_id（storage 里的那个）
  const selfDeviceId = getOrCreateDeviceId()

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmUntrustId, setConfirmUntrustId] = useState<string | null>(null)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      const res = await listMyDevices(supabase)
      setLoading(false)
      if (!res.ok) {
        setLoadError(t('devices.loadFailed'))
        return
      }
      setLoadError(null)
      setDevices(res.devices)
    },
    [t]
  )

  useEffect(() => {
    void load()
  }, [load])
  // 切回本页静默重取（另一台设备刚上线 / 刚被设为不信任时能看到最新状态）
  useDidShow(() => {
    void load({ silent: true })
  })

  const applyTrust = async (device: DeviceInfo, trusted: boolean) => {
    setBusyId(device.deviceId)
    const res = await setDeviceTrust(supabase, selfDeviceId, device.deviceId, trusted)
    setBusyId(null)
    if (!res.ok) {
      Taro.showToast({ title: t('devices.actionFailed'), icon: 'none' })
      return
    }
    // 顺序由服务端给（已信任优先），重新取一遍而不是本地改
    await load({ silent: true })
  }

  const confirmDevice = devices.find((d) => d.deviceId === confirmUntrustId)
  const confirmBusy = !!confirmUntrustId && busyId === confirmUntrustId

  return (
    <View className={`${darkClass} flex h-full min-h-0 flex-col bg-page-bg px-4 pb-safe`}>
      <ScrollView scrollY className='flex-1 min-h-0 mt-1'>
        <Text className='mb-3 block text-xs leading-relaxed text-text-muted'>
          {t('devices.subtitle')}
        </Text>
        <ListState
          loading={loading}
          isEmpty={devices.length === 0}
          error={loadError}
          emptyText={t('devices.empty')}
          onRetry={() => void load()}
        >
          <View className='pb-4'>
            {devices.map((device) => {
              const isSelf = device.deviceId === selfDeviceId
              const busy = busyId === device.deviceId
              return (
                <Card key={device.deviceId} className='mb-3'>
                  <View className='flex items-start justify-between gap-2'>
                    <Text className='min-w-0 flex-1 text-sm font-semibold text-text'>
                      {device.name}
                    </Text>
                    {isSelf ? (
                      <Text className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-text-muted'>
                        {t('devices.selfTag')}
                      </Text>
                    ) : !device.trusted ? (
                      <Text className='shrink-0 rounded-full bg-danger-bg px-2 py-0.5 text-xs text-danger'>
                        {t('devices.untrustedTag')}
                      </Text>
                    ) : null}
                  </View>

                  <Text className='mt-2 block text-xs text-text-muted'>
                    {t('devices.lastSeen', { time: formatDateTimeInChina(device.lastSeenAt) })}
                  </Text>

                  {/* 本机不给任何操作入口：拒绝自己 = 当场把自己锁在门外 */}
                  {isSelf ? null : (
                    <View className='mt-3 flex justify-end'>
                      <View
                        className={`rounded-xl border px-3 py-1.5 ${
                          device.trusted ? 'border-danger' : 'border-primary'
                        }`}
                        onClick={() => {
                          if (busy) return
                          if (device.trusted) {
                            setConfirmUntrustId(device.deviceId)
                          } else {
                            void applyTrust(device, true)
                          }
                        }}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            device.trusted ? 'text-danger' : 'text-primary'
                          }`}
                        >
                          {busy
                            ? t('common.actions.loading')
                            : device.trusted
                              ? t('devices.untrust')
                              : t('devices.trust')}
                        </Text>
                      </View>
                    </View>
                  )}
                </Card>
              )
            })}
          </View>
        </ListState>
      </ScrollView>

      {/* 设为不信任的二次确认（恢复信任是安全方向，不需要确认） */}
      <Modal
        open={!!confirmDevice}
        onClose={() => {
          if (confirmBusy) return
          setConfirmUntrustId(null)
        }}
        title={t('devices.untrustConfirmTitle')}
      >
        <Text className='block text-sm text-text'>{t('devices.untrustConfirmContent')}</Text>
        {confirmDevice ? (
          <Text className='mt-2 block text-xs text-text-muted'>{confirmDevice.name}</Text>
        ) : null}
        <View className='mt-4 flex gap-3'>
          <View
            className='flex-1 rounded-xl border border-border bg-card py-2 text-center'
            onClick={() => setConfirmUntrustId(null)}
          >
            <Text className='text-sm text-text'>{t('common.actions.cancel')}</Text>
          </View>
          <View
            className='flex-1 rounded-xl bg-danger py-2 text-center'
            onClick={() => {
              if (!confirmDevice || confirmBusy) return
              void applyTrust(confirmDevice, false).then(() => setConfirmUntrustId(null))
            }}
          >
            <Text className='text-sm text-primary-foreground'>
              {confirmBusy ? t('common.actions.loading') : t('common.actions.confirm')}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  )
}
