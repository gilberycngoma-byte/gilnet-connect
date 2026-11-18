import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '@/components/gpm/AppShell';
import { ReportsPanel } from '@/components/gpm/ReportsPanel';
import { APP_NAME } from '@/lib/version';
export const Route=createFileRoute('/reports')({head:()=>({meta:[{title:`Reports - ${APP_NAME}`},{name:'description',content:'Rooms sale Excel report, room check-in status PDF and daily operations report.'},{property:'og:title',content:'GILNET Reports'},{property:'og:description',content:'Export room sales to Excel and check-in status to PDF.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:Reports});
function Reports(){return <AppShell title="Reports" allow="reports"><ReportsPanel/></AppShell>;}
