'use client'

import * as React from 'react'
import { Maximize, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 全屏切换组件
 * 提供浏览器全屏模式切换功能，包含全屏状态监听和图标切换
 * 使用 HTML5 Fullscreen API 实现全屏控制
 *
 * @returns 全屏切换按钮组件
 */
export function FullscreenToggle() {
    // 当前全屏状态
    const [isFullscreen, setIsFullscreen] = React.useState(false)

    // 监听全屏状态变化
    React.useEffect(() => {
        const handleFullscreenChange = () => {
            // 根据 document.fullscreenElement 判断是否处于全屏状态
            setIsFullscreen(!!document.fullscreenElement)
        }

        // 添加全屏状态变化事件监听器
        document.addEventListener('fullscreenchange', handleFullscreenChange)
        // 组件卸载时移除事件监听器
        return () => {
            document.removeEventListener(
                'fullscreenchange',
                handleFullscreenChange
            )
        }
    }, [])

    // 切换全屏状态的函数
    const toggleFullscreen = React.useCallback(() => {
        if (!document.fullscreenElement) {
            // 进入全屏模式
            document.documentElement.requestFullscreen().catch((err) => {
                console.error('Error attempting to enable fullscreen:', err)
            })
        } else {
            // 退出全屏模式
            document.exitFullscreen().catch((err) => {
                console.error('Error attempting to exit fullscreen:', err)
            })
        }
    }, [])

    return (
        <Button variant="ghost" size="icon" onClick={toggleFullscreen}>
            {isFullscreen ? (
                <Minimize className="h-[1.2rem] w-[1.2rem]" />
            ) : (
                <Maximize className="h-[1.2rem] w-[1.2rem]" />
            )}
            <span className="sr-only">切换全屏</span>
        </Button>
    )
}
