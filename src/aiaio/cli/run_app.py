import sys
from argparse import ArgumentParser
import os

import uvicorn

from aiaio import logger

from . import BaseCLICommand


def run_app_command_factory(args):
    return RunAppCommand(args.port, args.host, args.workers, args.enable_search)


class RunAppCommand(BaseCLICommand):
    @staticmethod
    def register_subcommand(parser: ArgumentParser):
        run_app_parser = parser.add_parser(
            "app",
            description="✨ Run app",
        )
        run_app_parser.add_argument(
            "--port",
            type=int,
            default=10000,
            help="Port to run the app on",
            required=False,
        )
        run_app_parser.add_argument(
            "--host",
            type=str,
            default="127.0.0.1",
            help="Host to run the app on",
            required=False,
        )
        run_app_parser.add_argument(
            "--workers",
            type=int,
            default=1,
            help="Number of workers to run the app with",
            required=False,
        )
        run_app_parser.add_argument(
            "--enable-search",
            action='store_true',
            help="Enable search functionality",
        )
        run_app_parser.set_defaults(func=run_app_command_factory)

    def __init__(self, port, host, workers,enable_serach):
        self.port = port
        self.host = host
        self.workers = workers
        self.enable_search=enable_serach

    def run(self):

        logger.info("Starting aiaio server.")
        if not os.environ.get("enable_web_search"):
            if self.enable_search==True:
                os.environ["enable_web_search"]="True"
            else:
                os.environ["enable_web_search"] = ""

        try:
            uvicorn.run("aiaio.app.app:app", host=self.host, port=self.port, workers=self.workers)
        except KeyboardInterrupt:
            logger.warning("Server terminated by user.")
            sys.exit(0)
