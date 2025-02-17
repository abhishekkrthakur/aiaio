import sys
from argparse import ArgumentParser

import uvicorn

from aiaio import logger

from . import BaseCLICommand


def run_app_command_factory(args):
    return RunAppCommand(args.port, args.host, args.workers)


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
        run_app_parser.set_defaults(func=run_app_command_factory)

    def __init__(self, port, host, workers):
        self.port = port
        self.host = host
        self.workers = workers

    def run(self):

        logger.info("Starting aiaio server.")

        try:
            uvicorn.run("aiaio.app.app:app", host=self.host, port=self.port, workers=self.workers)
        except KeyboardInterrupt:
            logger.warning("Server terminated by user.")
            sys.exit(0)
