import {ChangeEventHandler, FC} from "react";
import {Search} from 'lucide-react'
export type SearchFieldProps = {
    value: string,
    onChange:  ChangeEventHandler<HTMLInputElement>,
    placeholder?: string
}

export const SearchField:FC<SearchFieldProps> = ({onChange,value, placeholder})=>{
    return <span className="search-field">
        <input value={value} onChange={onChange} placeholder={placeholder}/>
        <Search/>
    </span>
}
