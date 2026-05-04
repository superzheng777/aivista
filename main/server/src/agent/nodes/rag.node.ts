import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentState } from '../interfaces/agent-state.interface';
import { KnowledgeService, RetrievedStyle } from '../../knowledge/knowledge.service';

interface QueryContext {
  queryText: string;
  styleEnglish: string;
  keywords: string[];
}

interface RankedStyle extends RetrievedStyle {
  finalScore: number;
}

interface RetrievalOptions {
  queryText: string;
  styleEnglish: string;
  keywords: string[];
  finalLimit: number;
  recallLimit: number;
  hardMinSimilarity: number;
  rerankThreshold: number;
}

@Injectable()
export class RagNode {
  private readonly logger = new Logger(RagNode.name);

  private readonly styleMap: Record<string, string> = {
    '赛博朋克': 'Cyberpunk',
    '水彩': 'Watercolor',
    '水彩画': 'Watercolor',
    '极简': 'Minimalist',
    '极简主义': 'Minimalist',
    '油画': 'Oil Painting',
    '动漫': 'Anime',
    '动画': 'Anime',
    '像素': 'Pixel Art',
    '像素艺术': 'Pixel Art',
    '像素风': 'Pixel Art',
    '8位': 'Pixel Art',
    '复古游戏': 'Pixel Art',
    '水墨': 'Ink Painting',
    '水墨画': 'Ink Painting',
    '国画': 'Ink Painting',
    '中国画': 'Ink Painting',
    '写意': 'Ink Painting',
    '蒸汽波': 'Vaporwave',
    '复古': 'Vaporwave',
    '90年代': 'Vaporwave',
    '3D': '3D Rendering',
    '三维': '3D Rendering',
    '3D渲染': '3D Rendering',
    'CGI': '3D Rendering',
    '素描': 'Sketch',
    '铅笔画': 'Sketch',
    '草图': 'Sketch',
    '手绘': 'Sketch',
    '写实': 'Photorealistic',
    '摄影': 'Photorealistic',
    '照片': 'Photorealistic',
    '真实': 'Photorealistic',
    '逼真': 'Photorealistic',
    '电影': 'Cinematic',
    '影视': 'Cinematic',
    '电影感': 'Cinematic',
    '大片': 'Cinematic',
    '梦幻': 'Fantasy Wonderland',
    '仙境': 'Fantasy Wonderland',
    '奇幻': 'Fantasy Wonderland',
    '童话': 'Fantasy Wonderland',
    '魔法': 'Fantasy Wonderland',
    '哥特': 'Dark Gothic',
    '暗黑': 'Dark Gothic',
    '黑暗': 'Dark Gothic',
    '哥特风': 'Dark Gothic',
    '微距': 'Macro Photography',
    '特写': 'Macro Photography',
    '近景': 'Macro Photography',
    '细节': 'Macro Photography',
  };

  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly configService: ConfigService,
  ) {}

  async execute(state: AgentState): Promise<Partial<AgentState>> {
    this.logger.log('RAG Node: Starting style retrieval...');

    if (!state.intent) {
      return this.buildFallbackResponse(state.userInput.text, '未检测到意图，使用原始 Prompt');
    }

    if (state.intent.action === 'inpainting') {
      return this.buildFallbackResponse(state.userInput.text, '局部重绘任务直接使用用户编辑说明，不进行风格检索增强');
    }

    try {
      const queryContext = this.buildQueryContext(state);
      if (!queryContext.queryText) {
        return this.buildFallbackResponse(state.userInput.text, '查询文本为空，使用原始 Prompt');
      }

      const searchLimit = this.configService.get<number>('RAG_SEARCH_LIMIT') ?? 3;
      const softMinSimilarity = this.configService.get<number>('RAG_MIN_SIMILARITY') ?? 0.4;
      const hardMinSimilarity =
        this.configService.get<number>('RAG_HARD_MIN_SIMILARITY') ??
        Math.max(0.2, Number((softMinSimilarity * 0.75).toFixed(2)));
      const rerankThreshold =
        this.configService.get<number>('RAG_RERANK_THRESHOLD') ?? softMinSimilarity;
      const recallLimit =
        this.configService.get<number>('RAG_RECALL_LIMIT') ?? Math.max(searchLimit * 3, 10);

      let rankedResults = await this.searchAndRerank({
        queryText: queryContext.queryText,
        styleEnglish: queryContext.styleEnglish,
        keywords: queryContext.keywords,
        finalLimit: searchLimit,
        recallLimit,
        hardMinSimilarity,
        rerankThreshold,
      });

      if (rankedResults.length === 0 && queryContext.styleEnglish) {
        rankedResults = await this.searchAndRerank({
          queryText: queryContext.styleEnglish,
          styleEnglish: queryContext.styleEnglish,
          keywords: this.buildKeywords([queryContext.styleEnglish, state.intent.subject]),
          finalLimit: searchLimit,
          recallLimit,
          hardMinSimilarity: Math.max(0.15, Number((hardMinSimilarity * 0.85).toFixed(2))),
          rerankThreshold: Math.max(0.2, Number((rerankThreshold * 0.9).toFixed(2))),
        });

        if (rankedResults.length > 0) {
          this.logger.log('RAG Node: Retry search succeeded with English style name only');
        }
      }

      if (rankedResults.length === 0) {
        this.logger.warn(
          `RAG Node: No matching styles found after rerank (query: "${queryContext.queryText}")`,
        );
        return this.buildFallbackResponse(state.userInput.text, '未检索到可靠风格结果，使用原始 Prompt');
      }

      const originalPrompt = state.userInput.text;
      const retrievedPrompts = rankedResults.map((result) => result.prompt).join(', ');
      const finalPrompt = `${originalPrompt}, ${retrievedPrompts}`;
      const styleNames = rankedResults.map((result) => result.style).join('、');
      const scoreSummary = rankedResults
        .map((result) => `${result.style}:${result.similarity.toFixed(2)}/${result.finalScore.toFixed(2)}`)
        .join(', ');

      this.logger.log(
        `RAG Node: Retrieved ${rankedResults.length} styles after rerank: ${styleNames} (similarity/finalScore: ${scoreSummary})`,
      );
      this.logger.log(
        `RAG Node: Enhanced prompt - Original: "${originalPrompt}" -> Final: "${finalPrompt}"`,
      );

      return {
        enhancedPrompt: {
          original: originalPrompt,
          retrieved: rankedResults.map((result) => ({
            style: result.style,
            prompt: result.prompt,
            similarity: result.similarity,
          })),
          final: finalPrompt,
        },
        thoughtLogs: [
          {
            node: 'rag',
            message: `检索到 ${rankedResults.length} 条相关风格：${styleNames}`,
            timestamp: Date.now(),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`RAG Node error: ${message}`, stack);
      return this.buildFallbackResponse(state.userInput.text, '风格检索失败，使用原始 Prompt');
    }
  }

  private buildFallbackResponse(originalPrompt: string, message: string): Partial<AgentState> {
    return {
      enhancedPrompt: {
        original: originalPrompt,
        retrieved: [],
        final: originalPrompt,
      },
      thoughtLogs: [
        {
          node: 'rag',
          message,
          timestamp: Date.now(),
        },
      ],
    };
  }

  private buildQueryContext(state: AgentState): QueryContext {
    let queryText = '';
    let styleEnglish = '';

    if (state.intent?.style) {
      styleEnglish = this.styleMap[state.intent.style] || '';
      queryText = [
        state.intent.style,
        styleEnglish,
        styleEnglish,
        state.intent.subject,
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      queryText = [state.intent?.subject, state.userInput.text]
        .filter(Boolean)
        .join(' ');
    }

    const keywords = this.buildKeywords([
      state.intent?.style,
      styleEnglish,
      state.intent?.subject,
      state.userInput.text,
    ]);

    return {
      queryText,
      styleEnglish,
      keywords,
    };
  }

  private buildKeywords(parts: Array<string | undefined>): string[] {
    const keywords = new Set<string>();

    for (const part of parts) {
      if (!part) {
        continue;
      }

      const normalized = part.trim().toLowerCase();
      if (!normalized) {
        continue;
      }

      if (normalized.length > 1) {
        keywords.add(normalized);
      }

      const latinTokens = normalized.match(/[a-z0-9-]+/g) || [];
      for (const token of latinTokens) {
        if (token.length > 1) {
          keywords.add(token);
        }
      }
    }

    return Array.from(keywords);
  }

  private async searchAndRerank(options: RetrievalOptions): Promise<RankedStyle[]> {
    const candidates = await this.knowledgeService.search(options.queryText, {
      limit: options.finalLimit,
      recallLimit: options.recallLimit,
      minSimilarity: options.hardMinSimilarity,
    });

    if (candidates.length === 0) {
      return [];
    }

    const ranked = this.rerankResults(candidates, options.styleEnglish, options.keywords);
    const retained = ranked
      .filter((result) => result.finalScore >= options.rerankThreshold)
      .slice(0, options.finalLimit);

    if (retained.length === 0) {
      this.logger.warn(
        `RAG Node: No candidate passed rerank threshold ${options.rerankThreshold.toFixed(2)} for query "${options.queryText}"`,
      );
    }

    return retained;
  }

  private rerankResults(
    candidates: RetrievedStyle[],
    styleEnglish: string,
    keywords: string[],
  ): RankedStyle[] {
    return candidates
      .map((candidate) => {
        const similarityScore = this.clamp(candidate.similarity);
        const styleMatchScore =
          styleEnglish && candidate.style.toLowerCase() === styleEnglish.toLowerCase()
            ? 1
            : 0;
        const tagsMatchScore = this.calculateListMatchScore(candidate.tags, keywords);
        const promptKeywordScore = this.calculateTextKeywordScore(candidate.prompt, keywords);
        const finalScore = Number(
          (
            similarityScore * 0.75 +
            styleMatchScore * 0.2 +
            tagsMatchScore * 0.03 +
            promptKeywordScore * 0.02
          ).toFixed(4),
        );

        return {
          ...candidate,
          finalScore,
        };
      })
      .sort((a, b) => {
        if (b.finalScore !== a.finalScore) {
          return b.finalScore - a.finalScore;
        }
        return b.similarity - a.similarity;
      });
  }

  private calculateListMatchScore(values: string[] = [], keywords: string[]): number {
    if (!values.length || !keywords.length) {
      return 0;
    }

    const normalizedValues = values.map((value) => value.toLowerCase());
    const matchedCount = keywords.filter((keyword) =>
      normalizedValues.some((value) => value.includes(keyword) || keyword.includes(value)),
    ).length;

    return this.clamp(matchedCount / Math.max(keywords.length, 1));
  }

  private calculateTextKeywordScore(text: string, keywords: string[]): number {
    if (!text || !keywords.length) {
      return 0;
    }

    const normalizedText = text.toLowerCase();
    const matchedCount = keywords.filter((keyword) => normalizedText.includes(keyword)).length;

    return this.clamp(matchedCount / Math.max(keywords.length, 1));
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  }
}
