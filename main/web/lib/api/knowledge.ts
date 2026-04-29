import { fetchAPI, API_ENDPOINTS } from './client'
import type {
    StyleData,
    SearchOptions,
    SearchResult,
    KnowledgeStats,
    CreateStyleRequest,
    CreateStyleResponse,
    UpdateStyleRequest,
    BatchDeleteRequest,
    BatchDeleteResponse,
} from '@/lib/types/knowledge'

/*通过定义的类型（type/knowledge.ts）和封装的请求方法（api/client.ts）来获取所有知识库风格*/

// 获取所有知识库风格接口
export async function getStyles(): Promise<StyleData[]> {
    return fetchAPI<StyleData[]>(API_ENDPOINTS.KNOWLEDGE.STYLES)
}

// 获取知识库风格详情接口
export async function getStyleById(id: string): Promise<StyleData> {
    return fetchAPI<StyleData>(API_ENDPOINTS.KNOWLEDGE.STYLE_BY_ID(id))
}

// 知识库搜索风格接口
export async function searchStyles(
    options: SearchOptions
): Promise<SearchResult[]> {
    return fetchAPI<SearchResult[]>(API_ENDPOINTS.KNOWLEDGE.SEARCH, {
        params: {
            query: options.query,
            ...(options.limit && { limit: options.limit }),
            ...(options.minSimilarity && {
                minSimilarity: options.minSimilarity,
            }),
        },
    })
}

// 获取知识库统计接口
export async function getKnowledgeStats(): Promise<KnowledgeStats> {
    return fetchAPI<KnowledgeStats>(API_ENDPOINTS.KNOWLEDGE.STATS)
}

// 知识库创建新风格接口
export async function createStyle(
    data: CreateStyleRequest
): Promise<CreateStyleResponse> {
    return fetchAPI<CreateStyleResponse>(API_ENDPOINTS.KNOWLEDGE.STYLES, {
        method: 'POST',
        body: JSON.stringify(data),
    })
}

// 知识库更新风格接口
export async function updateStyle(
    id: string,
    data: UpdateStyleRequest
): Promise<void> {
    return fetchAPI<void>(API_ENDPOINTS.KNOWLEDGE.STYLE_BY_ID(id), {
        method: 'PATCH',
        body: JSON.stringify(data),
    })
}

// 知识库删除风格接口
export async function deleteStyle(id: string): Promise<void> {
    return fetchAPI<void>(API_ENDPOINTS.KNOWLEDGE.STYLE_BY_ID(id), {
        method: 'DELETE',
    })
}

// 知识库批量删除风格接口
export async function deleteStyles(
    ids: string[]
): Promise<BatchDeleteResponse> {
    return fetchAPI<BatchDeleteResponse>(API_ENDPOINTS.KNOWLEDGE.BATCH_DELETE, {
        method: 'POST',
        body: JSON.stringify({ ids }),
    })
}
