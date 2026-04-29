const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

export const API_ENDPOINTS = {
    AGENT: {
        INFO: '/api/agent',
        CHAT: '/api/agent/chat', // AI聊天接口
    },
    KNOWLEDGE: {
        STYLES: '/api/knowledge/styles', // 知识库样式接口
        STYLE_BY_ID: (id: string) => `/api/knowledge/styles/${id}`, // 知识库样式详情接口
        SEARCH: '/api/knowledge/search', // 知识库搜索接口
        STATS: '/api/knowledge/stats', // 知识库统计接口
        BATCH_DELETE: '/api/knowledge/styles/batch-delete', // 批量删除知识库样式接口
    },
} as const

interface RequestOptions extends RequestInit {
    params?: Record<string, string | number>
}

export async function fetchAPI<T>(
    endpoint: string,
    options?: RequestOptions
): Promise<T> {
    const { params, ...fetchOptions } = options || {}

    // 构建 URL（处理查询参数）
    let url = `${API_BASE_URL}${endpoint}`
    if (params) {
        const searchParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            searchParams.append(key, String(value))
        })
        url += `?${searchParams.toString()}`
    }

    // 发送请求
    const response = await fetch(url, {
        ...fetchOptions,
        headers: {
            'Content-Type': 'application/json',
            ...fetchOptions.headers,
        },
    })

    // 错误处理
    if (!response.ok) {
        const error = await response.json().catch(() => ({
            message: response.statusText,
        }))
        throw new APIError(
            error.message || 'API请求失败',
            response.status,
            error
        )
    }

    // 处理 204 No Content 响应
    if (response.status === 204) {
        return undefined as T
    }

    return response.json()
}

// 错误类
export class APIError extends Error {
    constructor(message: string, public status: number, public data?: any) {
        super(message)
        this.name = 'APIError'
    }
}
