/**
 * SmartCanvas 组件
 * 展示图片，支持 view 与 draw_mask 蒙版绘制
 */

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { SmartCanvasProps, MaskData } from '@/lib/types/genui'
import { Button } from '@/components/ui/button'
import { Eraser, Check, X } from 'lucide-react'

type Point = { x: number; y: number }

export function SmartCanvas({
    imageUrl,
    mode = 'view',
    ratio,
}: SmartCanvasProps) {
    const [isLoading, setIsLoading] = useState(true) // 图片加载状态
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 }) // 原始图片尺寸
    const [maskPaths, setMaskPaths] = useState<Point[][]>([]) // 已完成的蒙版路径
    const [currentPath, setCurrentPath] = useState<Point[]>([]) // 当前绘制中的路径
    const [isDrawing, setIsDrawing] = useState(false) // 是否正在绘制
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 }) // 容器尺寸

    // new
    const [internalMode, setInternalMode] = useState<'view' | 'draw_mask'>(mode)

    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const imgRef = useRef<HTMLImageElement>(null)

    useEffect(() => {
        setInternalMode(mode)
    }, [mode, imageUrl])

    // 图片加载完成时，设置图片尺寸
    const handleImageLoad = useCallback(() => {
        if (imgRef.current) {
            setImageSize({
                width: imgRef.current.naturalWidth,
                height: imgRef.current.naturalHeight,
            })
        }
        setIsLoading(false)
    }, [])

    // 测量容器尺寸
    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const updateSize = () => {
            if (el) {
                setContainerSize({
                    width: el.clientWidth,
                    height: el.clientHeight,
                })
            }
        }

        updateSize()
        const observer = new ResizeObserver(updateSize) // 监听容器尺寸变化
        observer.observe(el)
        return () => observer.disconnect() // 清理监听器
    }, [imageSize])

    // 绘制蒙版到 canvas ！！！
    useEffect(() => {
        if (!canvasRef.current || internalMode !== 'draw_mask') return
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'
        ctx.lineWidth = 6
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ;[...maskPaths, currentPath].forEach((path) => {
            if (path.length < 2) return
            ctx.beginPath()
            ctx.moveTo(path[0].x, path[0].y)
            for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i].x, path[i].y)
            }
            ctx.stroke()
        })
    }, [maskPaths, currentPath, internalMode])

    // 转换 canvas 坐标 ！！！
    const getCanvasPoint = useCallback(
        (clientX: number, clientY: number): Point | null => {
            const rect = canvasRef.current?.getBoundingClientRect()
            if (!rect) return null

            const scaleX = (canvasRef.current?.width ?? 1) / rect.width
            const scaleY = (canvasRef.current?.height ?? 1) / rect.height

            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY,
            }
        },
        []
    )

    // 开始绘制（鼠标按下）
    const handlePointerDown = useCallback(
        (e: React.PointerEvent) => {
            if (internalMode !== 'draw_mask') return
            const point = getCanvasPoint(e.clientX, e.clientY)
            if (point) {
                e.currentTarget.setPointerCapture(e.pointerId)
                setIsDrawing(true)
                setCurrentPath([point]) // 开始新路径，只有一个起点
            }
        },
        [internalMode, getCanvasPoint]
    )

    // 绘制路径（鼠标移动）
    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            if (!isDrawing || internalMode !== 'draw_mask') return
            const point = getCanvasPoint(e.clientX, e.clientY)
            if (point) {
                setCurrentPath((prev) => [...prev, point]) // 添加新点到当前路径
            }
        },
        [isDrawing, internalMode, getCanvasPoint]
    )

    // 结束绘制（鼠标抬起）
    const handlePointerUp = useCallback(() => {
        if (!isDrawing) return
        setMaskPaths((prev) => [...prev, currentPath])
        setCurrentPath([])
        setIsDrawing(false)
    }, [isDrawing, currentPath])

    // 清除所有路径
    const handleClear = useCallback(() => {
        setMaskPaths([])
        setCurrentPath([])
    }, [])

    // 取消蒙版编辑，返回查看模式
    const handleCancel = useCallback(() => {
        setInternalMode('view')
        // 可选：清除当前绘制的蒙版
        setMaskPaths([])
        setCurrentPath([])
        window.dispatchEvent(
            new CustomEvent('smart-canvas-cancel', { detail: { imageUrl } })
        )
    }, [imageUrl])

    // 导出蒙版数据 ！！！
    const exportMask = useCallback((): MaskData | null => {
        if (
            !canvasRef.current ||
            maskPaths.length === 0 ||
            imageSize.width === 0
        )
            return null

        const canvas = canvasRef.current
        const nW = imageSize.width
        const nH = imageSize.height
        const cW = canvas.width
        const cH = canvas.height
        const s = Math.min(cW / nW, cH / nH)
        const dW = nW * s
        const dH = nH * s
        const oX = (cW - dW) / 2
        const oY = (cH - dH) / 2

        const toImageCoords = (x: number, y: number) => ({
            x: (x - oX) / s,
            y: (y - oY) / s,
        })

        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = nW
        maskCanvas.height = nH
        const maskCtx = maskCanvas.getContext('2d')
        if (!maskCtx) return null

        maskCtx.fillStyle = 'white'
        maskPaths.forEach((path) => {
            if (path.length < 2) return
            const p0 = toImageCoords(path[0].x, path[0].y)
            maskCtx.beginPath()
            maskCtx.moveTo(p0.x, p0.y)
            for (let i = 1; i < path.length; i++) {
                const p = toImageCoords(path[i].x, path[i].y)
                maskCtx.lineTo(p.x, p.y)
            }
            maskCtx.closePath()
            maskCtx.fill()
        })

        const base64 = maskCanvas.toDataURL('image/png').split(',')[1]
        return {
            base64,
            imageUrl,
            coordinates: maskPaths.flat(),
        }
    }, [maskPaths, imageUrl, imageSize])

    const handleConfirm = useCallback(() => {
        const maskData = exportMask()
        if (maskData) {
            window.dispatchEvent(
                new CustomEvent('smart-canvas-mask', { detail: { maskData } })
            )
        }
    }, [exportMask])

    if (internalMode === 'draw_mask') {
        return (
            <div className="rounded-lg border bg-card overflow-hidden">
                <div
                    ref={containerRef}
                    className="relative bg-muted max-h-[300px] flex items-center justify-center"
                    style={
                        imageSize.width > 0
                            ? {
                                  aspectRatio: `${imageSize.width} / ${imageSize.height}`,
                              }
                            : undefined
                    }
                >
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
                        </div>
                    )}
                    <img
                        ref={imgRef}
                        src={imageUrl}
                        alt="Canvas"
                        className={cn(
                            'max-w-full max-h-[300px] object-contain block transition-opacity',
                            isLoading ? 'opacity-0' : 'opacity-100'
                        )}
                        onLoad={handleImageLoad}
                    />
                    {!isLoading && (
                        <canvas
                            ref={canvasRef}
                            width={containerSize.width}
                            height={containerSize.height}
                            className="absolute inset-0 cursor-crosshair touch-none"
                            style={{ touchAction: 'none' }}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerLeave={handlePointerUp}
                        />
                    )}
                </div>

                <div className="flex items-center gap-2 p-3 border-t bg-muted/30">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleClear}
                        disabled={
                            maskPaths.length === 0 && currentPath.length === 0
                        }
                    >
                        <Eraser className="h-4 w-4 mr-1" />
                        清除蒙版
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleConfirm}
                        disabled={
                            maskPaths.length === 0 && currentPath.length === 0
                        }
                    >
                        <Check className="h-4 w-4 mr-1" />
                        确认蒙版
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleCancel}>
                        <X className="h-4 w-4 mr-1" />
                        取消
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div
            className={cn(
                'relative overflow-hidden rounded-lg border bg-muted',
                ratio && 'aspect-[1/1] max-w-md'
            )}
            style={ratio ? { aspectRatio: `1/${ratio}` } : undefined}
        >
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
                </div>
            )}
            <img
                ref={imgRef}
                src={imageUrl}
                alt="Canvas"
                className={cn(
                    'block max-h-[200px] max-w-full w-auto h-auto object-contain transition-opacity',
                    isLoading ? 'opacity-0' : 'opacity-100'
                )}
                onLoad={handleImageLoad}
                onClick={() => setInternalMode('draw_mask')}
                title="点击进入蒙版编辑模式"
            />
        </div>
    )
}
