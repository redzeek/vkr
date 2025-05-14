import sys
from decimal import Decimal
import json
from flask import Flask, Response, request
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import date, datetime

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        elif isinstance(obj, (date, datetime)):
            return obj.isoformat()
        return super().default(obj)

app = Flask(__name__)
app.json_encoder = CustomJSONEncoder
app.config['JSON_AS_ASCII'] = False
CORS(app)
@app.route('/api/orders', methods=['POST'])
def create_order():
    try:
        data = request.json
        if not data or 'user_id' not in data or 'items' not in data:
            return json_response({'error': 'Необходим user_id и items'}, 400)

        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        for item in data['items']:
            cur.execute("SELECT quantity_in_stock FROM books WHERE id = %s", (item['book_id'],))
            book = cur.fetchone()
            if not book:
                return json_response({'error': f'Книга с ID {item["book_id"]} не найдена'}, 404)
            if book['quantity_in_stock'] < item['quantity']:
                return json_response({'error': f'Недостаточно книг с ID {item["book_id"]} на складе'}, 400)

        cur.execute("""
            INSERT INTO orders (user_id, total_amount, status)
            VALUES (%s, %s, 'processing')
            RETURNING id, order_date, total_amount, status
        """, (data['user_id'], data['total_amount']))
        order = cur.fetchone()

        for item in data['items']:
            cur.execute("SELECT price FROM books WHERE id = %s", (item['book_id'],))
            book_price = cur.fetchone()['price']

            cur.execute("""
                INSERT INTO order_items (order_id, book_id, quantity, price_at_purchase)
                VALUES (%s, %s, %s, %s)
            """, (order['id'], item['book_id'], item['quantity'], book_price))

            cur.execute("""
                UPDATE books 
                SET quantity_in_stock = quantity_in_stock - %s
                WHERE id = %s
            """, (item['quantity'], item['book_id']))

        conn.commit()
        return json_response({
            'order_id': order['id'],
            'order_date': order['order_date'].isoformat(),
            'total_amount': float(order['total_amount']),
            'status': order['status'],
            'message': 'Заказ успешно создан'
        }, 201)

    except Exception as e:
        conn.rollback()
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@app.route('/api/orders/user/<int:user_id>', methods=['GET'])
def get_user_orders(user_id):
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT o.id, o.order_date, o.total_amount, o.status
            FROM orders o
            WHERE o.user_id = %s
            ORDER BY o.order_date DESC
        """, (user_id,))
        orders = cur.fetchall()

        for order in orders:
            cur.execute("""
                SELECT 
                    oi.book_id, oi.quantity, oi.price_at_purchase,
                    b.title, a.name as author_name
                FROM order_items oi
                JOIN books b ON oi.book_id = b.id
                JOIN authors a ON b.author_id = a.id
                WHERE oi.order_id = %s
            """, (order['id'],))
            order['items'] = cur.fetchall()

        return json_response(orders)

    except Exception as e:
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@app.route('/api/orders/<int:order_id>/status', methods=['PUT', 'OPTIONS'])
def update_order_status(order_id):
    if request.method == 'OPTIONS':
        return json_response({}, 200)
    
    try:
        data = request.json
        if not data or 'status' not in data:
            return json_response({'error': 'Необходим статус'}, 400)

        valid_statuses = ['processing', 'shipped', 'delivered', 'cancelled']
        if data['status'] not in valid_statuses:
            return json_response({'error': 'Недопустимый статус'}, 400)

        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            UPDATE orders 
            SET status = %s 
            WHERE id = %s
            RETURNING id, status
        """, (data['status'], order_id))
        
        updated_order = cur.fetchone()
        if not updated_order:
            return json_response({'error': 'Заказ не найден'}, 404)
            
        conn.commit()
        return json_response({
            'message': 'Статус заказа обновлен',
            'order_id': updated_order['id'],
            'new_status': updated_order['status']
        })
        
    except Exception as e:
        conn.rollback()
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@app.route('/api/orders', methods=['GET'])
def get_all_orders():
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT 
                o.id, o.order_date, o.total_amount, o.status,
                u.username as user_name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            ORDER BY o.order_date DESC
        """)
        orders = cur.fetchall()

        for order in orders:
            cur.execute("""
                SELECT 
                    oi.book_id, oi.quantity, oi.price_at_purchase,
                    b.title, a.name as author_name
                FROM order_items oi
                JOIN books b ON oi.book_id = b.id
                JOIN authors a ON b.author_id = a.id
                WHERE oi.order_id = %s
            """, (order['id'],))
            order['items'] = cur.fetchall()

        return json_response(orders)

    except Exception as e:
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()
        
                        
def get_db():
    try:
        return psycopg2.connect(
            host="localhost",
            database="bookstore_db",
            user="postgres",
            password="123",
            port="5432"
        )
    except Exception as e:
        print("Ошибка подключения к БД:", e)
        raise
def json_response(data, status=200):
    return Response(
        json.dumps(data, cls=CustomJSONEncoder, ensure_ascii=False),
        status=status,
        mimetype='application/json'
    )

@app.route('/api/books', methods=['GET'])
def get_books():
    conn = None
    cur = None
    
    try:
        search = request.args.get('search', '').strip()
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 8))

        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        query = """
            SELECT 
                b.id, 
                b.title, 
                b.price, 
                b.quantity_in_stock,
                a.name as author_name
            FROM books b
            JOIN authors a ON b.author_id = a.id
        """
        count_query = "SELECT COUNT(*) FROM books b"
        params = []
        
        if search:
            query += " WHERE b.title ILIKE %s"
            count_query += " WHERE b.title ILIKE %s"
            params.append(f"%{search}%")
        
        query += " ORDER BY b.id LIMIT %s OFFSET %s"
        offset = (page - 1) * per_page
        params.extend([per_page, offset])
        
        cur.execute(count_query, params[:1] if search else [])
        total_books = cur.fetchone()['count']
        
        cur.execute(query, params)
        books = cur.fetchall()
        
        return json_response({
            'books': books,
            'pagination': {
                'total_books': total_books,
                'total_pages': (total_books + per_page - 1) // per_page,
                'current_page': page,
                'per_page': per_page
            }
        })

    except Exception as e:
        print(f"Ошибка в /api/books: {str(e)}", file=sys.stderr)
        return json_response({'error': str(e)}, 500)
    finally:
        if cur: cur.close()
        if conn: conn.close()

@app.route('/api/books/<int:book_id>', methods=['GET'])
def get_book(book_id):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cur.execute("""
            SELECT 
                b.*, 
                a.name as author_name,
                array_remove(array_agg(DISTINCT g.name), NULL) as genres
            FROM books b
            JOIN authors a ON b.author_id = a.id
            LEFT JOIN book_genres bg ON b.id = bg.book_id
            LEFT JOIN genres g ON bg.genre_id = g.id
            WHERE b.id = %s
            GROUP BY b.id, a.id
        """, (book_id,))
        
        book = cur.fetchone()
        if book:
            if 'price' in book:
                book['price'] = float(book['price'])
            if 'publication_date' in book and book['publication_date']:
                book['publication_date'] = book['publication_date'].isoformat()
            return json_response(book)
        return json_response({"error": "Книга не найдена"}, 404)
        
    except Exception as e:
        return json_response({"error": str(e)}, 500)
    finally:
        cur.close()
        conn.close()

@app.route('/api/books', methods=['POST'])
def create_book():
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    
    try:
        cur.execute("""
            INSERT INTO books (
                title, author_id, price, quantity_in_stock,
                description, publication_date
            ) VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            data['title'], data['author_id'], data['price'],
            data.get('quantity_in_stock', 0),
            data.get('description'),
            data.get('publication_date')
        ))
        
        book_id = cur.fetchone()[0]
        
        if 'genres' in data:
            for genre_id in data['genres']:
                cur.execute(
                    "INSERT INTO book_genres (book_id, genre_id) VALUES (%s, %s)",
                    (book_id, genre_id)
                )
        
        if 'tags' in data:
            for tag_id in data['tags']:
                cur.execute(
                    "INSERT INTO book_tags (book_id, tag_id) VALUES (%s, %s)",
                    (book_id, tag_id)
                )
        
        conn.commit()
        return json_response({"id": book_id}, 201)
        
    except Exception as e:
        conn.rollback()
        return json_response({"error": str(e)}, 400)
    finally:
        cur.close()
        conn.close()

@app.route('/api/authors', methods=['GET'])
def get_authors():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cur.execute("""
            SELECT id, name, bio, photo_url 
            FROM authors
        """)
        authors = cur.fetchall()
        return json_response(authors)
        
    except Exception as e:
        return json_response({"error": str(e)}, 500)
        
    finally:
        cur.close()
        conn.close()

@app.route('/api/genres', methods=['GET'])
def get_genres():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cur.execute("SELECT id, name FROM genres")
        genres = cur.fetchall()
        return json_response(genres)
        
    except Exception as e:
        return json_response({"error": str(e)}, 500)
        
    finally:
        cur.close()
        conn.close()

@app.route('/api/tags', methods=['GET'])
def get_tags():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cur.execute("SELECT id, name FROM tags")
        tags = cur.fetchall()
        return json_response(tags)
        
    except Exception as e:
        return json_response({"error": str(e)}, 500)
        
    finally:
        cur.close()
        conn.close()
@app.route('/api/cart-books', methods=['GET'])
def get_cart_books():
    book_ids_str = request.args.get('ids', '')
    if not book_ids_str:
        return json_response([])
    
    try:
        book_ids = [int(id) for id in book_ids_str.split(',') if id.isdigit()]
        if not book_ids:
            return json_response([])
            
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        cur.execute("""
            SELECT b.id, b.title, b.price, b.quantity_in_stock, 
                   a.name as author_name
            FROM books b
            JOIN authors a ON b.author_id = a.id
            WHERE b.id = ANY(%s)
        """, (book_ids,))
        
        books = cur.fetchall()
        return json_response(books)
        
    except Exception as e:
        return json_response({'error': str(e)}), 500
        
    finally:
        if 'conn' in locals():
            if 'cur' in locals():
                cur.close()
            conn.close()

@app.route('/api/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        required_fields = ['username', 'password', 'email']
        if not all(field in data for field in required_fields):
            return json_response({'error': 'Все поля обязательны'}, 400)

        conn = get_db()
        cur = conn.cursor()

        cur.execute("SELECT id FROM users WHERE username = %s OR email = %s", 
                   (data['username'], data['email']))
        if cur.fetchone():
            return json_response({'error': 'Пользователь с такими данными уже существует'}, 400)

        cur.execute(
            """INSERT INTO users (username, email, password, role) 
            VALUES (%s, %s, %s, 'customer') 
            RETURNING id, username, email, role""",
            (data['username'], data['email'], data['password'])
        )
        user = cur.fetchone()
        conn.commit()

        return json_response({
            'id': user[0],
            'username': user[1],
            'email': user[2],
            'role': user[3]
        }, 201)

    except Exception as e:
        conn.rollback()
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()
        
@app.route('/api/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data or 'username' not in data or 'password' not in data:
            return json_response({'error': 'Требуется имя пользователя и пароль'}, 400)

        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        cur.execute(
            "SELECT id, username, email, role FROM users WHERE username = %s AND password = %s",
            (data['username'], data['password'])
        )
        user = cur.fetchone()

        if not user:
            return json_response({'error': 'Неверные учетные данные'}, 401)

        return json_response(dict(user))

    except Exception as e:
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@app.route('/api/books/<int:book_id>', methods=['DELETE'])
def delete_book(book_id):
    try:
        conn = get_db()
        cur = conn.cursor()
        
        cur.execute("SELECT id FROM books WHERE id = %s", (book_id,))
        if not cur.fetchone():
            return json_response({'error': 'Книга не найдена'}, 404)
        
        cur.execute("DELETE FROM books WHERE id = %s", (book_id,))
        conn.commit()
        
        return json_response({'message': 'Книга успешно удалена'})
        
    except Exception as e:
        conn.rollback()
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@app.route('/api/authors/search', methods=['GET'])
def search_authors():
    name = request.args.get('name', '').strip()
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cur.execute("""
            SELECT id, name FROM authors 
            WHERE name ILIKE %s 
            LIMIT 10
        """, (f"%{name}%",))
        authors = cur.fetchall()
        return json_response(authors)
        
    except Exception as e:
        return json_response({"error": str(e)}, 500)
    finally:
        cur.close()
        conn.close()
@app.route('/api/authors', methods=['POST'])
def create_author():
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    
    try:
        if not data or 'name' not in data:
            return json_response({"error": "Необходимо указать имя автора"}, 400)
            
        cur.execute("""
            INSERT INTO authors (name) 
            VALUES (%s) 
            RETURNING id
        """, (data['name'],))
        
        author_id = cur.fetchone()[0]
        conn.commit()
        return json_response({"id": author_id}, 201)
        
    except Exception as e:
        conn.rollback()
        return json_response({"error": str(e)}, 400)
    finally:
        cur.close()
        conn.close()      


@app.route('/api/books/<int:book_id>', methods=['PUT'])
def update_book(book_id):
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    
    try:
        cur.execute("SELECT id FROM books WHERE id = %s", (book_id,))
        if not cur.fetchone():
            return json_response({'error': 'Книга не найдена'}, 404)
        
        cur.execute("""
            UPDATE books SET
                title = %s,
                author_id = %s,
                price = %s,
                quantity_in_stock = %s,
                description = %s,
                publication_date = %s
            WHERE id = %s
        """, (
            data['title'],
            data['author_id'],
            data['price'],
            data.get('quantity_in_stock', 0),
            data.get('description'),
            data.get('publication_date'),
            book_id
        ))
        
        if 'genres' in data:
            cur.execute("DELETE FROM book_genres WHERE book_id = %s", (book_id,))
            for genre_id in data['genres']:
                cur.execute(
                    "INSERT INTO book_genres (book_id, genre_id) VALUES (%s, %s)",
                    (book_id, genre_id)
                )
        
        if 'tags' in data:
            cur.execute("DELETE FROM book_tags WHERE book_id = %s", (book_id,))
            for tag_id in data['tags']:
                cur.execute(
                    "INSERT INTO book_tags (book_id, tag_id) VALUES (%s, %s)",
                    (book_id, tag_id)
                )
        
        conn.commit()
        return json_response({'message': 'Книга успешно обновлена'})
        
    except Exception as e:
        conn.rollback()
        return json_response({'error': str(e)}, 400)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@app.route('/api/update-role', methods=['POST'])
def update_role():
    if not request.json or 'username' not in request.json or 'new_role' not in request.json:
        return json_response({'error': 'Необходимо указать username и new_role'}, 400)

    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        cur.execute("SELECT id FROM users WHERE username = %s", (request.json['username'],))
        user = cur.fetchone()
        if not user:
            return json_response({'error': 'Пользователь не найден'}, 404)
        
        valid_roles = ['customer', 'employee', 'admin']
        if request.json['new_role'] not in valid_roles:
            return json_response({'error': 'Недопустимая роль'}, 400)
            
        cur.execute(
            "UPDATE users SET role = %s WHERE username = %s RETURNING id, username, role",
            (request.json['new_role'], request.json['username'])
        )
        updated_user = cur.fetchone()
        conn.commit()
        
        return json_response({
            'message': 'Роль успешно обновлена',
            'user': dict(updated_user)
        })
        
    except Exception as e:
        conn.rollback()
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

@app.route('/api/users', methods=['GET'])
def get_users():
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        cur.execute("SELECT id, username, email, role FROM users")
        users = cur.fetchall()
        return json_response(users)
        
    except Exception as e:
        return json_response({'error': str(e)}, 500)
    finally:
        if 'cur' in locals(): cur.close()
        if 'conn' in locals(): conn.close()

if __name__ == '__main__':
    app.run(debug=True)