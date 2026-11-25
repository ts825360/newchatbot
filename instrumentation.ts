export async function register() {
  if(process.env.NEXT_RUNTIME!=="nodejs")return;
  const state=globalThis as typeof globalThis & {__googleExportTimer?:ReturnType<typeof setInterval>;__googleExportBusy?:boolean};
  if(state.__googleExportTimer)return;
  state.__googleExportTimer=setInterval(async()=>{
    if(state.__googleExportBusy)return;
    state.__googleExportBusy=true;
    try{const {syncAllGoogleExports}=await import("./lib/server/google-export");await syncAllGoogleExports();}
    catch{/* Durable source data will be retried on the next interval. */}
    finally{state.__googleExportBusy=false;}
  },60000);
  state.__googleExportTimer.unref?.();
  const reportTimer = setInterval(() => {
    void import("./lib/server/issue-reports").then(({ dispatchReportNotifications }) => dispatchReportNotifications()).catch(() => {});
  }, 60_000);
  reportTimer.unref?.();
}
