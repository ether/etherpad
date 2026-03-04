import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import {createBrowserRouter, createRoutesFromElements, Route, RouterProvider} from "react-router-dom";
import {HomePage} from "./pages/HomePage.tsx";
import {SettingsPage} from "./pages/SettingsPage.tsx";
import {LoginScreen} from "./pages/LoginScreen.tsx";
import {HelpPage} from "./pages/HelpPage.tsx";
import * as Toast from '@radix-ui/react-toast'
import {I18nextProvider} from "react-i18next";
import i18n from "./localization/i18n.ts";
import {PadPage} from "./pages/PadPage.tsx";
import {ToastDialog} from "./utils/Toast.tsx";
import {ShoutPage} from "./pages/ShoutPage.tsx";

const router = createBrowserRouter(createRoutesFromElements(
    <><Route element={<App/>}>
        <Route index element={<HomePage/>}/>
        <Route path="/plugins" element={<HomePage/>}/>
        <Route path="/settings" element={<SettingsPage/>}/>
        <Route path="/help" element={<HelpPage/>}/>
        <Route path="/pads" element={<PadPage/>}/>
        <Route path="/shout" element={<ShoutPage/>}/>
    </Route><Route path="/login">
        <Route index element={<LoginScreen/>}/>
    </Route></>
), {
    basename: import.meta.env.BASE_URL
})


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
      <I18nextProvider i18n={i18n}>
      <Toast.Provider>
          <ToastDialog/>
          <RouterProvider router={router}/>
      </Toast.Provider>
      </I18nextProvider>
  </React.StrictMode>,
)
