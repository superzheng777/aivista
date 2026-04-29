import { useEffect, useState } from 'react'

/**
 * 防抖钩子函数
 * 用于延迟执行函数或值更新，避免频繁触发导致的性能问题
 * 常用于搜索框输入、窗口大小调整等需要防抖的场景
 *
 * @template T - 值的泛型类型
 * @param value - 需要防抖处理的值
 * @param delay - 防抖延迟时间（毫秒）
 * @returns 防抖后的值
 */
export function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value)

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value)
        }, delay)

        return () => {
            clearTimeout(handler)
        }
    }, [value, delay])

    return debouncedValue
}
