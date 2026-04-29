'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { type ThemeProviderProps } from 'next-themes/dist/types'

/**
 * 主题提供者组件
 * 包装 next-themes 库的 ThemeProvider，为应用提供主题切换功能
 * 支持暗色/亮色主题切换和系统主题跟随
 *
 * @param children - 子组件
 * @param props - ThemeProviderProps 配置属性
 * @returns 包装后的主题提供者组件
 */

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
    return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
