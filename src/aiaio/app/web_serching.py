from duckduckgo_search import DDGS
import requests
from bs4 import BeautifulSoup


def extract_text(bs, min_len_item=100):
    items_for_scanning = bs.find_all("article")
    if not items_for_scanning:
        items_for_scanning = bs.find_all("p")
    out_text = ""
    for item in items_for_scanning:
        if len(item.text) < min_len_item:
            continue

        if not len(item.find_all("p")):
            out_text += "\n" + item.text
        else:
            for paragraph in item.find_all("p"):
                if len(paragraph.text) < min_len_item:
                    continue
                out_text += "\n" + paragraph.text

    return out_text


def get_text_from_first_websites(keywords: str, max_results=5):
    results = DDGS().text(keywords, max_results=max_results)
    output = []
    for result in results:
        url = result["href"]
        try:
            respone = requests.get(url)
            if str(respone.status_code).startswith("2"):
                respone.encoding = respone.apparent_encoding
                bs_text = BeautifulSoup(respone.text, features='html.parser')
                output.append(extract_text(bs_text))
        except:
            pass
    return output


if __name__ == "__main__":
    print(get_text_from_first_websites("python"))
