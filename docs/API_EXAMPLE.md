# Пример API

Ответ получен при локальном запуске проверяемой версии. Данные демонстрационные.

```http
GET /api/listings/1 HTTP/1.1
Host: localhost:4600
```

HTTP 200

```json
{
  "id": 1,
  "title": "Светлая квартира у парка",
  "district": "Хамовники",
  "address": "Усачёва, 15",
  "rooms": 2,
  "area": 54,
  "floor": 7,
  "price": 145000,
  "style": "olive",
  "accent": "#899477",
  "features": [
    "балкон",
    "гардеробная",
    "парк"
  ],
  "available": 1
}
```
