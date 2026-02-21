# test-auth.py
import requests
import json
import os
import sys

def get_puter_token(username, password):
    url = "https://api.puter.com/login"
    payload = {
        "username": username,
        "password": password
    }
    headers = {
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(url, json=payload, headers=headers)
        if response.status_code == 200:
            data = response.json()
            return data.get("token")
        else:
            print(f"Error: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"Exception: {e}")
        return None

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    user = os.getenv("PUTER_USERNAME")
    pw = os.getenv("PUTER_PASSWORD")
    if not user or not pw:
        print("Missing credentials in .env")
        sys.exit(1)
    
    token = get_puter_token(user, pw)
    if token:
        print(f"Token: {token}")
    else:
        print("Failed to get token")
