const os = require('os');
const http = require('http');
const { json } = require('stream/consumers');

// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Generate random port between 3000-9000
function getRandomPort() {
    return Math.floor(Math.random() * (9000 - 3000 + 1)) + 3000;
}

// Active rooms storage
const activeRooms = new Map();

function createHostService() {
    
    function createRoomServer(roomId, hostInfo) {
        const port = 3000;
        const localIP = getLocalIP();
        
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            
            if (req.url === '/room' || req.url === `/room/${roomId}`) {
                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    room: {
                        id: roomId,
                        host: hostInfo,
                        url: `http://${localIP}:${port}/room`,
                        createdAt: new Date().toISOString()
                    }
                }));
                return;
            }
            
            if (req.url === '/health') {
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'alive', roomId }));
                return;
            }
            
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
        });
        
        server.listen(port, '0.0.0.0', () => {
            console.log(`Room server running at http://${localIP}:${port}/room`);
        });
        
        return { server, port, localIP, url: `http://${localIP}:${port}/room` };
    }

    return {
      createRoom(roomData) {
        const roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        const hostInfo = {
          hostId: roomData.hostId,
          pcName: os.hostname(),
          localIP: getLocalIP(),
          playerName: roomData.playerName,
          map: roomData.map,
          mapname: roomData.mapname,
          gameId: roomData.gameId,
          port: null,
          createdAt: new Date().toISOString(),
        };

        const { server, port, url } = createRoomServer(roomId, hostInfo);

        hostInfo.port = port;
        hostInfo.url = url;

        activeRooms.set(roomId, {
          id: roomId,
          server,
          hostInfo,
          players: [],
        });

        return {
          success: true,
          room: {
            id: roomId,
            url,
            host: hostInfo,
          },
        };
      },

      async getRooms() {
        let rooms = [];

        for (const [id, room] of activeRooms) {
          rooms.push({
            id: room.id,
            host: room.hostInfo,
            playerCount: room.players.length,
            url: room.hostInfo.url,
          });
        }

        if (rooms.length === 0) {
          rooms = await this.getRoomFromLink();
        }

        return rooms;
      },

      async getRoomFromLink() {
        const localIP = getLocalIP();
        const subnet = localIP.split(".").slice(0, 3).join(".") + ".";

        const found = [];
        const ports = 3000; 
        const promises = [];

        for (let i = 1; i < 255; i++) {
          const ip = subnet + i;

          promises.push(
            fetch(`http://${ip}:${ports}/room`, {
              signal: AbortSignal.timeout(7000),
            })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (data?.room) {
                  found.push({
                    id: data.room.id,
                    host: data.room.host,
                    playerCount: 0,
                    url: data.room.url,
                  });
                }
              })
              .catch(() => null),
          );
        }

        await Promise.all(promises);

        return found;
      },

      closeRoom(roomId) {
        const room = activeRooms.get(roomId);
        if (room) {
          room.server.close();
          activeRooms.delete(roomId);
          return { success: true };
        }
        return { success: false, error: "Room not found" };
      },
    };
}

module.exports = { createHostService };