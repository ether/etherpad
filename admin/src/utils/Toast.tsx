import * as Toast from '@radix-ui/react-toast'
import {useStore} from "../store/store.ts";
import {useMemo} from "react";

export const ToastDialog = ()=>{
    const toastState = useStore(state => state.toastState)
    const resultingClass = useMemo(()=> {
        return toastState.success?'ToastRootSuccess':'ToastRootFailure'
    },    [toastState.success])

    console.log()
    return <>
        <Toast.Root className={"ToastRoot "+resultingClass} open={toastState && toastState.open} onOpenChange={()=>{
          useStore.getState().setToastState({
              ...toastState!,
              open: !toastState?.open
          })
        }}>
        <Toast.Title className="ToastTitle">{toastState.title}</Toast.Title>
        <Toast.Description asChild>
            {toastState.description}
        </Toast.Description>
    </Toast.Root>
        <Toast.Viewport className="ToastViewport"/>
    </>
}
