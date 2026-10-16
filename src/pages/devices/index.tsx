import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { Card } from '@/components/ui/Card'
import { ListState } from '@/components/ui/ListState'
import { Modal } from '@/components/ui/Modal'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useT, useNavTitle } from '@/i18n'
import { getOrCreateDeviceId } from '@/lib/device-id'
import {
  deleteDevice,
  listMyDevices,
  selfFirst,
  setDeviceTrust,
  verifySession,
  type DeviceInfo,
} from '@/lib/device-session'
import { supabase } from '@/lib/supabase'
import { formatDateTimeInChina } from '@/lib/date-utils'
import './index.scss'

/**
 * 登录设备（「我的 → 设置 → 登录设备」进入）。
 *
 * 多设备模型下没有「顶号」：每台设备在 user_devices 里各占一行，互不影响。这里有两个动作，
 * 都**只对别的设备**：
 * - 「设为不信任」：立刻下线，且在被恢复信任之前拒绝它再登录（行保留，所以能恢复）；
 * - 「删除设备」：立刻下线、从列表消失，它下次登录会被当作新设备（并给本人发一条通知）。
 *
 * **本机那一行两个入口都不提供**：把自己拒绝/删除掉会当场把自己锁在门外
 * （服务端另有 cannot_untrust_self / cannot_block_self 硬拦）。
 *
 * 行是三态，但第三态在这里看不见：已信任 / 已拒绝登录（列表里带标记）/ 已删除 ——
 * 后者由服务端 list_my_devices 过滤掉，在用户眼里就是「从未登录过」。
 */
export default function DevicesPage() {
  const darkClass = useThemeClass()
  const { kickSelf } = useUser()
  const { t } = useT()
  useNavTitle('devices.navTitle')

  // 本机标识：与登录/轮询用的是同一个 device_id（storage 里的那个）
  const selfDeviceId = getOrCreateDeviceId()

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmUntrustId, setConfirmUntrustId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

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

  /**
   * 设备管理前的**自查**（用户 2026-10-16 定，规则 C）：本机若已被**设为不信任 / 删除**，
   * 就不该还能操作别的设备 —— 而发现即**直接踢出**（`kickSelf` 走的是与 15 秒轮询完全
   * 相同的那条链路：清会话 → 回登录页 → 弹窗说明是被拒还是被删）。
   *
   * 为什么要有这一道（服务端已经硬拦了）：那台设备在被心跳踢掉之前还有最长半分钟的窗口，
   * 页面要在这半分钟里就把它请出去，而不是让它再点几下、每次都吃一个「操作失败」。
   *
   * 返回 false = 已经踢了，调用方别再往下走。
   */
  const ensureSelfTrusted = async (): Promise<boolean> => {
    const v = await verifySession(supabase)
    if (!v.kicked) return true
    kickSelf(v.kind ?? 'rejected')
    return false
  }

  /**
   * 服务端明确拒绝（`caller_not_trusted`）：本机已经不可信了 —— 那是竞态窗口里发生的事
   * （自查之后、RPC 到达之前被另一台设备设成了不信任）。现读一次原因再踢，
   * 好让弹窗说清是「被设为不信任」还是「被删除设备」。
   */
  const kickAsUntrusted = async () => {
    const v = await verifySession(supabase)
    kickSelf(v.kicked ? (v.kind ?? 'rejected') : 'rejected')
  }

  const applyTrust = async (device: DeviceInfo, trusted: boolean) => {
    if (!(await ensureSelfTrusted())) return
    setBusyId(device.deviceId)
    const res = await setDeviceTrust(supabase, selfDeviceId, device.deviceId, trusted)
    setBusyId(null)
    if (!res.ok) {
      if (res.reason === 'caller_not_trusted') {
        await kickAsUntrusted()
        return
      }
      Taro.showToast({ title: t('devices.actionFailed'), icon: 'none' })
      return
    }
    // 顺序由服务端给（已信任优先），重新取一遍而不是本地改
    await load({ silent: true })
  }

  const applyDelete = async (device: DeviceInfo) => {
    if (!(await ensureSelfTrusted())) return
    setBusyId(device.deviceId)
    const res = await deleteDevice(supabase, selfDeviceId, device.deviceId)
    setBusyId(null)
    if (!res.ok) {
      if (res.reason === 'caller_not_trusted') {
        await kickAsUntrusted()
        return
      }
      Taro.showToast({ title: t('devices.deleteFailed'), icon: 'none' })
      return
    }
    Taro.showToast({ title: t('devices.deleteSuccess'), icon: 'success' })
    // 重新取一遍而不是本地摘掉那一行：删掉的那台同时也是「已信任」顺序的一部分，
    // 且下一次静默刷新（切回本页）本来就会重取，本地改只会让两份状态对不上
    await load({ silent: true })
  }

  const confirmDevice = devices.find((d) => d.deviceId === confirmUntrustId)
  const confirmBusy = !!confirmUntrustId && busyId === confirmUntrustId
  const deleteDeviceInfo = devices.find((d) => d.deviceId === confirmDeleteId)
  const deleteBusy = !!confirmDeleteId && busyId === confirmDeleteId

  // **本机始终排最前**（`selfFirst` 只改显示顺序，不动拉取结果）：用户打开这一页最先要找的
  // 就是「这台」—— 它既是「我正在用哪台」的答案，也是别的那几台上「拿哪一行去比对」的参照。
  const ordered = useMemo(() => selfFirst(devices, selfDeviceId), [devices, selfDeviceId])

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
            {ordered.map((device) => {
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

                  {/* 本机不给任何操作入口：拒绝/删除自己 = 当场把自己锁在门外 */}
                  {isSelf ? null : (
                    <View className='mt-3 flex justify-end gap-2'>
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
                      {/* 删除比「设为不信任」更进一步：设备会从列表消失，下次登录当新设备 */}
                      <View
                        className='rounded-xl border border-danger px-3 py-1.5'
                        onClick={() => {
                          if (busy) return
                          setConfirmDeleteId(device.deviceId)
                        }}
                      >
                        <Text className='text-xs font-medium text-danger'>
                          {t('devices.deleteDevice')}
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

      {/* 删除设备的二次确认：后果比「设为不信任」多一层（会消失、下次登录当新设备），正文写清 */}
      <Modal
        open={!!deleteDeviceInfo}
        onClose={() => {
          if (deleteBusy) return
          setConfirmDeleteId(null)
        }}
        title={t('devices.deleteConfirmTitle')}
      >
        <Text className='block text-sm text-text'>{t('devices.deleteConfirmContent')}</Text>
        {deleteDeviceInfo ? (
          <Text className='mt-2 block text-xs text-text-muted'>{deleteDeviceInfo.name}</Text>
        ) : null}
        <View className='mt-4 flex gap-3'>
          <View
            className='flex-1 rounded-xl border border-border bg-card py-2 text-center'
            onClick={() => setConfirmDeleteId(null)}
          >
            <Text className='text-sm text-text'>{t('common.actions.cancel')}</Text>
          </View>
          <View
            className='flex-1 rounded-xl bg-danger py-2 text-center'
            onClick={() => {
              if (!deleteDeviceInfo || deleteBusy) return
              void applyDelete(deleteDeviceInfo).then(() => setConfirmDeleteId(null))
            }}
          >
            <Text className='text-sm text-primary-foreground'>
              {deleteBusy ? t('common.actions.loading') : t('common.actions.delete')}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  )
}
