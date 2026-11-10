import { Button, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useNavTitle, useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useAnnouncements } from '@/hooks/useAnnouncements'
import { ListState } from '@/components/ui/ListState'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatDateTimeInChina } from '@/lib/date-utils'
import './index.scss'

export default function PresidentAnnouncementsPage() {
  const { t } = useT()
  useNavTitle('president.announcement.navTitle')
  const darkClass = useThemeClass()
  const { ready, user } = useUser()
  const { data, loading, error, fetch } = useAnnouncements(undefined, {
    enabled: ready && !!user,
  })

  useDidShow(() => {
    if (ready && user) void fetch({ silent: true })
  })

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <View className='flex items-center justify-end px-4 pb-2 pt-3'>
        <Button
          hoverClass='none'
          className='m-0 w-auto rounded-full bg-primary px-4 py-1.5 text-xs leading-normal text-primary-foreground'
          onClick={() => void Taro.navigateTo({ url: '/pages/president-announcement-edit/index' })}
        >
          + {t('president.announcement.create')}
        </Button>
      </View>

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-safe pt-1'>
          <ListState
            loading={loading}
            isEmpty={data.length === 0}
            emptyText={t('president.announcement.empty')}
            error={error ? t('president.announcement.loadFailed') : null}
            onRetry={() => void fetch()}
          >
            {data.map((item) => {
              const active = new Date(item.end_time).getTime() > Date.now()
              return (
                <View
                  key={item.id}
                  className='mb-3 rounded-2xl border border-border bg-card p-4'
                  onClick={() =>
                    void Taro.navigateTo({
                      url: `/pages/president-announcement-edit/index?id=${item.id}`,
                    })
                  }
                >
                  <View className='flex items-start gap-2'>
                    <Text className='min-w-0 flex-1 text-base font-semibold text-text'>
                      {item.title}
                    </Text>
                    <StatusChip tone={active ? 'success' : 'neutral'}>
                      {active
                        ? t('president.announcement.active')
                        : t('president.announcement.ended')}
                    </StatusChip>
                  </View>
                  {item.content ? (
                    <Text className='mt-2 block whitespace-pre-wrap text-sm leading-relaxed text-text-muted line-clamp-3'>
                      {item.content}
                    </Text>
                  ) : null}
                  <Text className='mt-2 block text-[10px] text-text-muted'>
                    {t('president.announcement.endTime')}: {formatDateTimeInChina(item.end_time)}
                  </Text>
                </View>
              )
            })}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
