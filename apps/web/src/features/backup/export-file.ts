import{Capacitor}from'@capacitor/core'
import{Directory,Filesystem}from'@capacitor/filesystem'
import{Share}from'@capacitor/share'

export interface ExportFile{filename:string;content:string;mimeType:string}
function toBase64(value:string){const bytes=new TextEncoder().encode(value);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary)}
export async function saveExportFile(file:ExportFile,native=Capacitor.isNativePlatform()){
 if(native){const path=`exports/${file.filename}`;const written=await Filesystem.writeFile({path,data:toBase64(file.content),directory:Directory.Cache,recursive:true});try{await Share.share({title:file.filename,url:written.uri,dialogTitle:'Zapisz lub udostępnij eksport'})}finally{await Filesystem.deleteFile({path,directory:Directory.Cache})}return}
 const blob=new Blob([file.content],{type:file.mimeType});const url=URL.createObjectURL(blob);try{const anchor=document.createElement('a');anchor.href=url;anchor.download=file.filename;anchor.style.display='none';document.body.appendChild(anchor);anchor.click();anchor.remove()}finally{URL.revokeObjectURL(url)}
}
