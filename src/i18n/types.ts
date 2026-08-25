export type Primitive = string | number | boolean

export type Dict = { [k: string]: Dict | Primitive }

/** 由基准字典类型推导出的所有点分路径（如 'profile.settings.language'），供 t() 做编译期校验 */
export type Path<T> = T extends Primitive
  ? never
  : T extends object
    ? {
        [K in keyof T & string]: T[K] extends Primitive
          ? K
          : T[K] extends object
            ? K | `${K}.${Path<T[K]>}`
            : never
      }[keyof T & string]
    : never
