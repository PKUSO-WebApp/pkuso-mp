import { useCallback } from 'react'
import { Button, ScrollView, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useNavTitle, useT } from '@/i18n'
import { useThemeClass } from '@/context/theme-context'
import { useUser } from '@/context/user-context'
import { useRehearsals } from '@/hooks/useRehearsals'
import { ListState } from '@/components/ui/ListState'
import { RehearsalCard } from '@/pages/index/components/rehearsal-card'
import './index.scss'

export default function PresidentRehearsalsPage() {
  const { t } = useT()
  useNavTitle('president.rehearsal.navTitle')
  const darkClass = useThemeClass()
  const { ready, user } = useUser()
  const { data, loading, error, fetch } = useRehearsals(undefined, {
    enabled: ready && !!user,
  })

  const reload = useCallback(() => {
    void fetch({ silent: true })
  }, [fetch])

  useDidShow(() => {
    if (ready && user) reload()
  })

  return (
    <View className={`${darkClass} flex h-full flex-col bg-page-bg`}>
      <View className='flex items-center justify-end px-4 pb-2 pt-3'>
        <Button
          hoverClass='none'
          className='m-0 w-auto rounded-full bg-primary px-4 py-1.5 text-xs leading-normal text-primary-foreground'
          onClick={() => void Taro.navigateTo({ url: '/pages/president-rehearsal-edit/index' })}
        >
          + {t('president.rehearsal.create')}
        </Button>
      </View>

      <ScrollView scrollY className='flex-1 min-h-0'>
        <View className='px-4 pb-safe pt-1'>
          <ListState
            loading={loading}
            isEmpty={data.length === 0}
            emptyText={t('president.rehearsal.empty')}
            error={error ? t('president.rehearsal.loadFailed') : null}
            onRetry={() => void fetch()}
          >
            {data.map((item) => (
              <View key={item.id} className='mb-3'>
                <RehearsalCard
                  item={item}
                  seen
                  onClick={() =>
                    void Taro.navigateTo({
                      url: `/pages/president-rehearsal-detail/index?id=${item.id}`,
                    })
                  }
                />
              </View>
            ))}
          </ListState>
        </View>
      </ScrollView>
    </View>
  )
}
