import {useEffect, useState} from "react";
import {SendHorizonal} from 'lucide-react'
import {useStore} from "../store/store.ts";
import * as Switch from '@radix-ui/react-switch';
import {ShoutType} from "../components/ShoutType.ts";

export const ShoutPage = ()=>{
    const [totalUsers, setTotalUsers] = useState(0);
    const [message, setMessage] = useState<string>("");
    const [sticky, setSticky] = useState<boolean>(false);
    const socket = useStore(state => state.settingsSocket);
    const pluginSocket = useStore(state => state.pluginsSocket);
    const [shouts, setShouts] = useState<ShoutType[]>([]);


    useEffect(() => {
        if(socket && pluginSocket) {
          console.log('Socket connected', socket.id);
            socket.on('shout', (shout) => {
                setShouts([...shouts, shout])
            })
          pluginSocket.on('results:stats', (statData) => {
            setTotalUsers(statData.totalUsers);
          })
        }
    }, [socket, shouts, pluginSocket])


  useEffect(() => {
    if (pluginSocket) {
      pluginSocket.emit('getStats', {});
    }
  }, [pluginSocket]);

    const sendMessage = () => {
        socket?.emit('shout', {
            message,
            sticky
        });
        setMessage('')
    }

    return (
        <div>
            <h1>Communication</h1>
            {totalUsers > 0 && <p>There  {totalUsers>1?"are":"is"} currently {totalUsers} user{totalUsers>1?"s":""} online</p>}
            <div style={{height: '80vh', display: 'flex', flexDirection: 'column'}}>
                <div style={{flexGrow: 1, backgroundColor: 'white', overflowY: "auto"}}>
                    {
                        shouts.map((shout) => {
                            return (
                                <div key={shout.data.payload.timestamp} className="message">
                                    <div>{shout.data.payload.message.message}</div>
                                    <div style={{display: 'flex'}}>
                                        <div style={{flexGrow: 1}}></div>
                                        <div
                                            style={{color: "lightgray"}}>{new Date(shout.data.payload.timestamp).toLocaleTimeString()
                                            + " " + new Date(shout.data.payload.timestamp).toLocaleDateString()}</div>
                                    </div>
                                </div>
                            )
                        })
                    }
                </div>
                <form onSubmit={(e) => {
                    e.preventDefault()
                    sendMessage()
                }} className="send-message search-field" style={{display: 'flex', gap: '10px'}}>
                    <Switch.Root title="Change sticky message" className="SwitchRoot" checked={sticky}
                                 onCheckedChange={() => {
                                     setSticky(!sticky);
             }}>
                 <Switch.Thumb className="SwitchThumb"/>
             </Switch.Root>
                    <input required value={message} onChange={v=>setMessage(v.target.value)}
                           style={{width: '100%', paddingRight: '55px', backgroundColor: '#e0e0e0', flexGrow: 1}}/>
                    <SendHorizonal style={{bottom: '5px', right: '9px', color: '#0f775b'}} onClick={()=>sendMessage()}/>
                </form>
            </div>
        </div>
    )
}
