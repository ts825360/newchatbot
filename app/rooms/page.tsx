import type { Metadata } from "next";
import { RoomLobby } from "@/components/room-lobby";
import "./rooms.css";
import "./room-lobby-reference.css";

export const metadata: Metadata = { title: "행사방 | 행사비서" };

export default function RoomsPage() { return <RoomLobby />; }
