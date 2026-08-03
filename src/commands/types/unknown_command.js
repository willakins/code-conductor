const { BaseCalypsoCommand } = require("./base_command");

class UnknownCommand extends BaseCalypsoCommand {
  constructor() {
    super("unknown");
  }

  parse() {
    return this.buildRespondParsedCommand("Unknown subcommand. Run `/conductor help` for usage.");
  }
}

module.exports = {
  UnknownCommand,
};
