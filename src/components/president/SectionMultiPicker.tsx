import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import { Modal } from '@/components/ui/Modal'
import { useT } from '@/i18n'
import { INSTRUMENT_ORDER, SECTION_GROUPS } from '@/constants/instruments'

/** 按乐团展示顺序（INSTRUMENT_ORDER）排列组内声部，而不是按常量的录入顺序 */
function orderSections(members: readonly string[]): readonly string[] {
  return INSTRUMENT_ORDER.filter((section) => (members as readonly string[]).includes(section))
}

const STRINGS = orderSections(SECTION_GROUPS.弦乐)
const WOODWINDS = orderSections(SECTION_GROUPS.木管)
const BRASS = orderSections(SECTION_GROUPS.铜管)

type Group = {
  key: string
  label: string
  members: readonly string[]
  children: { key: string; label: string; members: readonly string[] }[]
}

/**
 * 分排目标声部。层级与乐团编制一致：
 * 管乐（木管 / 铜管）→ 具体声部；弦乐 → 具体声部。
 * 只存具体声部名（组只是快捷方式），与 web 的 SectionSelect 一致。
 */
const SECTION_TREE: Group[] = [
  {
    key: 'winds',
    label: '管乐',
    members: [...WOODWINDS, ...BRASS],
    children: [
      { key: 'woodwinds', label: '木管', members: WOODWINDS },
      { key: 'brass', label: '铜管', members: BRASS },
    ],
  },
  {
    key: 'strings',
    label: '弦乐',
    members: STRINGS,
    children: [],
  },
]

type Props = {
  value: string[]
  disabled?: boolean
  onChange: (value: string[]) => void
}

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

  const renderSections = (members: readonly string[]) => (
    <View className='grid grid-cols-2 gap-2'>
      {members.map((section) => {
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
  )

  const renderGroupHeader = (label: string, members: readonly string[], level: 'top' | 'sub') => {
    const allSelected = members.every((section) => selected.has(section))
    return (
      <View
        className={`flex items-center justify-between ${level === 'top' ? '' : 'py-1'}`}
        onClick={() => toggleGroup(members)}
      >
        <Text
          className={
            level === 'top'
              ? 'text-sm font-medium text-text'
              : 'text-xs font-medium text-text-muted'
          }
        >
          {label}
        </Text>
        <Text className={`text-xs ${allSelected ? 'text-primary' : 'text-text-muted'}`}>
          {allSelected ? '✓' : t('president.rehearsal.allSections')}
        </Text>
      </View>
    )
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
          className='m-0 flex w-auto items-center rounded-full border border-border bg-surface px-3 py-1 text-text disabled:opacity-50'
          onClick={() => setOpen(true)}
        >
          <Text className='text-xs leading-normal'>{t('president.rehearsal.chooseSections')}</Text>
          <Text className='ml-1 text-sm leading-none text-text-muted'>▾</Text>
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

        {SECTION_TREE.map((group) => (
          <View key={group.key} className='mb-2 rounded-xl border border-border bg-muted p-3'>
            {renderGroupHeader(group.label, group.members, 'top')}
            {group.children.length > 0 ? (
              <View className='mt-2 border-l-2 border-border pl-3'>
                {group.children.map((child) => (
                  <View key={child.key} className='mb-2'>
                    {renderGroupHeader(child.label, child.members, 'sub')}
                    {renderSections(child.members)}
                  </View>
                ))}
              </View>
            ) : (
              <View className='mt-2'>{renderSections(group.members)}</View>
            )}
          </View>
        ))}

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
