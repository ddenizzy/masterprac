# Loads libnowplaying.dylib into Apple's perl (which may read Now Playing) and prints its JSON.
use DynaLoader;
my $lib = DynaLoader::dl_load_file($ARGV[0], 0) or die DynaLoader::dl_error();
my $sym = DynaLoader::dl_find_symbol($lib, "np_get") or die DynaLoader::dl_error();
DynaLoader::dl_install_xsub("main::np_get", $sym);
$| = 1;
np_get();
