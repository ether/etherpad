import {DependencyList, EffectCallback, useMemo, useRef} from "react";
import {useAnimationFrame} from "./AnimationFrameHook";

const defaultDeps: DependencyList = []

export const useDebounce = (
    fn:EffectCallback,
    wait = 0,
    deps = defaultDeps
):void => {
    const isFirstRender = useRef(true)
    const render = useAnimationFrame(fn, wait)

    useMemo(()=>{
        if(isFirstRender.current){
            isFirstRender.current = false
            return
        }

        render()
    }, deps)
}