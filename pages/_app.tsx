import { GCScript } from "../components/gcScript";
import { Analytics } from '@vercel/analytics/react';

function MyApp({ Component, pageProps }) {

    return <>
        <Analytics />
        <GCScript siteUrl={"https://trevorstenson.goatcounter.com/count"} />
        <Component {...pageProps} />
    </>
}

export default MyApp