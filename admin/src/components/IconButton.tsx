import {FC, JSX, ReactElement} from "react";

export type IconButtonProps = {
    style?: React.CSSProperties,
    icon: JSX.Element,
    title: string|ReactElement,
    onClick: ()=>void,
    className?: string,
    disabled?: boolean
}

export const IconButton:FC<IconButtonProps> = ({icon,className,onClick,title, disabled, style})=>{
    return <button style={style}  onClick={onClick} className={"icon-button "+ className} disabled={disabled}>
        {icon}
        <span>{title}</span>
        </button>
}
