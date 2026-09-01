import os
from requests import Session
from fantraxapi import League

LEAGUE_ID = "xa7tza2hmthqz8bo"

cookie_string = os.environ.get("FANTRAX_COOKIE")

if not cookie_string:
    raise RuntimeError("FANTRAX_COOKIE GitHub Secret is missing.")

session = Session()

for cookie in cookie_string.split(";"):
    cookie = cookie.strip()

    if "=" not in cookie:
        continue

    name, value = cookie.split("=", 1)
    session.cookies.set(name.strip(), value.strip())

print("Fantrax cookies loaded.")
print(f"Connecting to league: {LEAGUE_ID}")

league = League(
    LEAGUE_ID,
    session=session
)

print("Successfully connected to Fantrax.")

standings = league.standings()

print("\nSTANDINGS OBJECT:")
print(standings)

print("\nRANKS:")
print(standings.ranks)
