import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Read a credential from the flat omelet config by dotted path.")
    parser.add_argument("path", help="Dotted key path, e.g. openai_api_key or vbee.app_id")
    args = parser.parse_args()

    config_path = os.environ.get("OMELET_CONFIG", os.path.expanduser("~/.omelet.json"))
    try:
        with open(config_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError as error:
        print(f"cannot read {config_path}: {error}", file=sys.stderr)
        sys.exit(1)

    value = data
    for part in args.path.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        else:
            print(f"credential not found: {args.path}", file=sys.stderr)
            sys.exit(1)

    if isinstance(value, (dict, list)):
        print(json.dumps(value, ensure_ascii=False))
    else:
        print(value)


if __name__ == "__main__":
    main()
