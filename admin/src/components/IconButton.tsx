import {ButtonHTMLAttributes, FC, JSX, ReactElement} from "react";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'onClick'> & {
  icon: JSX.Element,
  title: string|ReactElement,
  onClick: ()=>void,
}

export const IconButton: FC<IconButtonProps> = ({icon, className, onClick, title, type = 'button', ...rest}) => (
  <button {...rest} type={type} onClick={onClick} className={"icon-button " + (className ?? "")}>
    {icon}
    <span>{title}</span>
  </button>
);
