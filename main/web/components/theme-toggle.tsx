'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { Button } from '@/components/ui/button'

/**
 * 主题切换组件
 * 提供暗色/亮色主题切换功能，包含太阳和月亮图标动画
 * 使用 next-themes 库管理主题状态
 * 支持服务器端渲染（SSR）兼容性处理
 *
 * @returns 主题切换按钮组件
 */
export function ThemeToggle() {
    // 获取当前主题和设置主题的函数
    const { theme, setTheme } = useTheme()
    // 组件挂载状态，用于处理 SSR 时的水合问题
    // ### 使用use client指令，服务端则可以初始化 mounted 状态
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return null
    }

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">切换主题</span>
        </Button>
    )
}
