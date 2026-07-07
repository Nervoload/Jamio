type RoomCodeBadgeProps = {
  roomCode: string;
};

export function RoomCodeBadge({ roomCode }: RoomCodeBadgeProps) {
  return (
    <div className="room-code-badge" aria-label={`Room code ${roomCode}`}>
      <span>Room</span>
      <strong>{roomCode || "ROOM"}</strong>
    </div>
  );
}
