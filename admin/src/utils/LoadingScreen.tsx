import {useStore} from "../store/store.ts";
import * as Dialog from '@radix-ui/react-dialog';
import brand from './brand.svg'

export const LoadingScreen = ()=>{
    const showLoading = useStore(state => state.showLoading)

    return <Dialog.Root open={showLoading}><Dialog.Portal>
        <Dialog.Overlay className="loading-screen fixed inset-0 bg-black bg-opacity-50 z-50 dialog-overlay" />
        <Dialog.Content  className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 dialog-content">
            <div className="flex flex-col items-center">
                <div className="animate-spin w-16 h-16 border-t-2 border-b-2 border-[--fg-color] rounded-full"></div>
                <div className="mt-4 text-[--fg-color]">
                    <img src={brand}/>
                </div>
            </div>
        </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
}
