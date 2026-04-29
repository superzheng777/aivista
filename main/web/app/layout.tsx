import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'

// 全局字体配置
const inter = Inter({ subsets: ['latin'] })

// 定义页面元数据
export const metadata: Metadata = {
    title: 'AiVista Web',
    description: 'AI Agent 工作流前端应用',
}

// 定义根布局组件
export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="zh-CN" suppressHydrationWarning>
            <body className={inter.className}>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                >
                    {children}
                    <Toaster />
                </ThemeProvider>
            </body>
        </html>
    )
}
