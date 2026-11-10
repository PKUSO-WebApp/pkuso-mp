import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/i18n'
import { ALL_SECTIONS, SECTION_GROUPS } from '@/constants/instruments'

const UNIQUE_SECTIONS = [...new Set(ALL_SECTIONS)]

type Props = {
  value: string[]
  disabled?: boolean
  onChange: (value: string[]) => void
}

/**
 * 分排目标声部：声部组一键全选 + 单个声部切换。
 * 只存具体声部名（与 web 的 SectionSelect 一样，组只是快捷方式）。
 */
export function SectionMultiPicker({ value, disabled = false, onChange }: Props) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const selected = new Set(value)

  const toggleSection = (section: string) => {
    if (selected.has(section)) {
      onChange(value.filter((item) => item !== section))
    } else {
      onChange([...value, section])
    }
  }

  const toggleGroup = (group: readonly string[]) => {
    const allSelected = group.every((section) => selected.has(section))
    if (allSelected) {
      onChange(value.filter((section) => !group.includes(section)))
    } else {
      const next = new Set(value)
      group.forEach((section) => next.add(section))
      onChange([...next])
    }
  }

  return (
    <View>
      <View className='flex flex-wrap items-center gap-2'>
        {value.length === 0 ? (
          <Text className='text-xs text-text-muted'>{t('president.rehearsal.chooseSections')}</Text>
        ) : (
          value.map((section) => (
            <View
              key={section}
              className='rounded-full bg-primary/10 px-2 py-1'
              onClick={() => !disabled && toggleSection(section)}
            >
              <Text className='text-xs text-primary'>{section} ×</Text>
            </View>
          ))
        )}
        <Button
          hoverClass='none'
          disabled={disabled}
          className='m-0 w-auto rounded-full border border-border bg-surface px-3 py-1 text-xs leading-normal text-text disabled:opacity-50'
          onClick={() => setOpen(true)}
        >
          {t('president.rehearsal.chooseSections')}
        </Button>
      </View>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('president.rehearsal.targetSections')}
        position='bottom'
      >
        <Text className='mb-3 block text-xs text-text-muted'>
          {t('president.rehearsal.selectedSections', { count: value.length })}
        </Text>

        {Object.entries(SECTION_GROUPS).map(([groupName, members]) => {
          const allSelected = members.every((section) => selected.has(section))
          return (
            <View
              key={groupName}
              className='mb-2 flex items-center justify-between rounded-xl border border-border bg-muted px-3 py-2'
              onClick={() => toggleGroup(members)}
            >
              <Text className='text-sm text-text'>{groupName}</Text>
              <Text className={`text-xs ${allSelected ? 'text-primary' : 'text-text-muted'}`}>
                {allSelected ? '✓' : t('president.rehearsal.allSections')}
              </Text>
            </View>
          )
        })}

        <View className='mt-3 grid grid-cols-2 gap-2'>
          {UNIQUE_SECTIONS.map((section) => {
            const active = selected.has(section)
            return (
              <View
                key={section}
                className={`rounded-xl border px-3 py-2 ${
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-surface text-text'
                }`}
                onClick={() => toggleSection(section)}
              >
                <Text className='text-xs'>{section}</Text>
              </View>
            )
          })}
        </View>

        <Button
          hoverClass='none'
          className='mt-4 w-full rounded-xl bg-primary py-2 text-sm leading-normal text-primary-foreground'
          onClick={() => setOpen(false)}
        >
          {t('common.actions.confirm')}
        </Button>
      </Modal>
    </View>
  )
}
