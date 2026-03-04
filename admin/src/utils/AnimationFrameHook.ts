import {useCallback, useEffect, useRef} from "react";

type Args = any[]

export const useAnimationFrame = <Fn extends (...args: Args)=>void>(
    callback: Fn,
    wait = 0
): ((...args: Parameters<Fn>)=>void)=>{
    const rafId = useRef(0)
    const render = useCallback(
        (...args: Parameters<Fn>)=>{
            cancelAnimationFrame(rafId.current)
            const timeStart = performance.now()

            const renderFrame = (timeNow: number)=>{
                if(timeNow-timeStart<wait){
                    rafId.current = requestAnimationFrame(renderFrame)
                    return
                }
                callback(...args)
            }
            rafId.current = requestAnimationFrame(renderFrame)
        }, [callback, wait]
    )


    useEffect(()=>cancelAnimationFrame(rafId.current),[])
    return render
}